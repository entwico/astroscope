import type { Rule } from 'eslint';

// typescript-eslint adds `importKind` to estree's import nodes
type WithImportKind = { importKind?: 'type' | 'value' | undefined };

/**
 * The registry (`src/wormholes.ts`) carries the loaders and with them the
 * project's server code. Client-side modules read wormholes through the
 * `wormholes` proxy from the package; a registry import there fails the client
 * build, this rule says so at lint time. Scoped to `.tsx`/`.jsx` (island code) —
 * a `.ts` file may legitimately be server code that uses the registry.
 */
const REGISTRY_SOURCE = /(^|\/)wormholes(\/index)?(\.[jt]s)?$/;

export const noRegistryImport: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'forbid importing the wormhole registry from island code',
    },
    messages: {
      registryImport:
        'the wormhole registry is server-only (its loaders are server code) — read wormholes through the `wormholes` proxy from `@astroscope/wormhole` instead.',
    },
    schema: [],
  },
  create(context) {
    if (!/\.[jt]sx$/.test(context.filename)) return {};

    return {
      ImportDeclaration(node) {
        if ((node as WithImportKind).importKind === 'type') return;
        if (typeof node.source.value !== 'string' || !REGISTRY_SOURCE.test(node.source.value)) return;

        const valueSpecifiers = node.specifiers.filter(
          (specifier) => specifier.type !== 'ImportSpecifier' || (specifier as WithImportKind).importKind !== 'type',
        );

        if (valueSpecifiers.length === 0) return;

        context.report({ node, messageId: 'registryImport' });
      },
    };
  },
};
