import { Parser } from 'acorn';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

const HOOK_NAMES = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);
const REACT_SOURCE = /^react(\/.*)?$/;
const TRANSFORMABLE = /\.(?:[mc]?[jt]sx?)$/;
const EMPTY_FN = '(()=>{})';

/**
 * In SSR builds, react effect hooks never execute. Emptying their callbacks
 * lets rolldown drop dead branches — including dynamic imports of client-only
 * libs (maplibre-gl, hls.js, etc.) — from the server bundle, which in turn
 * stops nft from tracing them at docker-image time.
 *
 * Scope is deliberately narrow: first-party code only (no node_modules), only
 * in the SSR pass, and binding-aware (the React import must resolve to the
 * real react package). Raw chunks where bundling has erased the binding are
 * left alone — that's NFT's domain, not ours.
 */
export function stripSsrEffectsPlugin(): Plugin {
  return {
    name: '@astroscope/react/strip-effects',
    enforce: 'post',
    transform(code, id, options) {
      if (!options?.ssr) return null;
      if (id.includes('/node_modules/')) return null;

      const cleanId = id.split('?', 1)[0] ?? id;

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

        const specifiers = node.specifiers ?? [];

        for (const spec of specifiers) {
          if (spec.type === 'ImportSpecifier') {
            const imported = spec.imported?.name ?? spec.imported?.value;

            if (HOOK_NAMES.has(imported)) directHooks.add(spec.local.name);
          } else if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
            namespaceHooks.add(spec.local.name);
          }
        }
      });

      // a parameter or local declared under a hook's name shadows the import
      // somewhere in the file; without scope tracking that name is left alone
      for (const name of collectDeclaredNames(ast)) {
        directHooks.delete(name);
        namespaceHooks.delete(name);
      }

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

        // only a callback literal is inert during render; any other expression
        // (`subscribe(store)`, a hook call) runs on the server too and stays
        if (arg.type !== 'ArrowFunctionExpression' && arg.type !== 'FunctionExpression') return;

        replacements.push({ start: arg.start, end: arg.end });
      });

      if (replacements.length === 0) return null;

      const s = new MagicString(code);

      for (const { start, end } of replacements) {
        s.overwrite(start, end, EMPTY_FN);
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }).toString() };
    },
  };
}

/** every name the file declares outside its react imports: locals, params, functions, classes, catch params */
function collectDeclaredNames(ast: any): Set<string> {
  const names = new Set<string>();

  walk(ast, (node) => {
    switch (node.type) {
      case 'VariableDeclarator': {
        collectPatternNames(node.id, names);
        break;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const params: any[] = node.params ?? [];

        if (node.id) names.add(node.id.name);
        for (const param of params) collectPatternNames(param, names);
        break;
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        if (node.id) names.add(node.id.name);
        break;
      }
      case 'CatchClause': {
        if (node.param) collectPatternNames(node.param, names);
        break;
      }
      case 'ImportDeclaration': {
        const specifiers: any[] = node.specifiers ?? [];

        if (typeof node.source?.value !== 'string' || REACT_SOURCE.test(node.source.value)) break;
        for (const spec of specifiers) names.add(spec.local.name);
        break;
      }
    }
  });

  return names;
}

function collectPatternNames(pattern: any, names: Set<string>): void {
  switch (pattern?.type) {
    case 'Identifier': {
      names.add(pattern.name);
      break;
    }
    case 'ObjectPattern': {
      for (const property of pattern.properties) collectPatternNames(property.value ?? property.argument, names);
      break;
    }
    case 'ArrayPattern': {
      for (const element of pattern.elements) collectPatternNames(element, names);
      break;
    }
    case 'RestElement': {
      collectPatternNames(pattern.argument, names);
      break;
    }
    case 'AssignmentPattern': {
      collectPatternNames(pattern.left, names);
      break;
    }
  }
}

function walk(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return;

  if (typeof node.type === 'string') visit(node);

  for (const v of Object.values(node)) {
    if (Array.isArray(v)) for (const item of v) walk(item, visit);
    else if (v && typeof v === 'object') walk(v, visit);
  }
}
