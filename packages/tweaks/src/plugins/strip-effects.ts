import { Parser } from 'acorn';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

const HOOK_NAMES = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);
const REACT_SOURCE = /^react(\/.*)?$/;
const TRANSFORMABLE = /\.(?:[mc]?[jt]sx?)$/;
const EMPTY_FN = '(()=>{})';

/**
 * in SSR builds, react effect hooks never execute. emptying their callbacks
 * lets rolldown drop dead branches — including dynamic imports of client-only
 * libs (maplibre-gl, hls.js, etc.) — from the server bundle, which in turn
 * stops nft from tracing them at docker-image time.
 *
 * scope is deliberately narrow: first-party code only (no node_modules), only
 * in the SSR pass, and binding-aware (the React import must resolve to the
 * real react package). raw chunks where bundling has erased the binding are
 * left alone — that's NFT's domain, not ours.
 */
export function stripSsrEffectsPlugin(): Plugin {
  return {
    name: '@astroscope/tweaks/strip-effects',
    enforce: 'post',
    transform(code, id, options) {
      if (!options?.ssr) return null;
      if (id.includes('/node_modules/')) return null;

      const cleanId = id.split('?')[0] ?? id;

      if (!TRANSFORMABLE.test(cleanId)) return null;
      if (!code.includes('useEffect') && !code.includes('useLayoutEffect') && !code.includes('useInsertionEffect')) {
        return null;
      }

      let ast: any;

      try {
        ast = Parser.parse(code, {
          ecmaVersion: 'latest',
          sourceType: 'module',
          allowReturnOutsideFunction: true,
          allowAwaitOutsideFunction: true,
          allowImportExportEverywhere: true,
          allowHashBang: true,
        });
      } catch {
        return null;
      }

      const directHooks = new Set<string>();
      const namespaceHooks = new Set<string>();

      walk(ast, (node) => {
        if (node.type !== 'ImportDeclaration') return;

        const src = node.source?.value;

        if (typeof src !== 'string' || !REACT_SOURCE.test(src)) return;

        for (const spec of node.specifiers ?? []) {
          if (spec.type === 'ImportSpecifier') {
            const imported = spec.imported?.name ?? spec.imported?.value;

            if (HOOK_NAMES.has(imported)) directHooks.add(spec.local.name);
          } else if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
            namespaceHooks.add(spec.local.name);
          }
        }
      });

      if (directHooks.size === 0 && namespaceHooks.size === 0) return null;

      const replacements: { start: number; end: number }[] = [];

      walk(ast, (node) => {
        if (node.type !== 'CallExpression' || !node.arguments?.length) return;

        const callee = node.callee;
        const isDirect = callee.type === 'Identifier' && directHooks.has(callee.name);
        const isMember =
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object?.type === 'Identifier' &&
          namespaceHooks.has(callee.object.name) &&
          callee.property?.type === 'Identifier' &&
          HOOK_NAMES.has(callee.property.name);

        if (!isDirect && !isMember) return;

        const arg = node.arguments[0];

        replacements.push({ start: arg.start, end: arg.end });
      });

      if (replacements.length === 0) return null;

      const s = new MagicString(code);

      for (const { start, end } of replacements) {
        s.overwrite(start, end, EMPTY_FN);
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}

function walk(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return;

  if (typeof node.type === 'string') visit(node);

  for (const key of Object.keys(node)) {
    const v = node[key];

    if (Array.isArray(v)) for (const item of v) walk(item, visit);
    else if (v && typeof v === 'object') walk(v, visit);
  }
}
