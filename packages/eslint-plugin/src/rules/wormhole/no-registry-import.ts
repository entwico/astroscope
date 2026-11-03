import type { Rule } from 'eslint';
import { type Linked, type WithExportKind, type WithImportKind, importExpressionSource } from '../../utils/ast.js';

/**
 * The registry (`src/wormholes.ts`) carries the loaders and with them the
 * project's server code. Client-side modules read wormholes through the
 * `wormholes` proxy from the package; a registry import there fails the client
 * build, this rule says so at lint time. Scoped to `.tsx`/`.jsx` (island code) —
 * a `.ts` file may legitimately be server code that uses the registry. Every
 * form that loads the module counts: a value import, a bare side-effect
 * import, a re-export and a dynamic `import()`; type-only ones are erased.
 */
const REGISTRY_SOURCE = /(^|\/)wormholes(\/index)?(\.[cm]?[jt]sx?)?$/;

function isRegistrySource(value: unknown): boolean {
  return typeof value === 'string' && REGISTRY_SOURCE.test(value);
}

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
        if (!isRegistrySource(node.source.value)) return;

        const valueSpecifiers = node.specifiers.filter(
          (specifier) => specifier.type !== 'ImportSpecifier' || (specifier as WithImportKind).importKind !== 'type',
        );

        // a bare `import '../wormholes'` loads the module like any other value import
        if (node.specifiers.length > 0 && valueSpecifiers.length === 0) return;

        context.report({ node, messageId: 'registryImport' });
      },

      ExportNamedDeclaration(node) {
        if ((node as WithExportKind).exportKind === 'type') return;
        if (!isRegistrySource(node.source?.value)) return;

        const valueSpecifiers = node.specifiers.filter(
          (specifier) => (specifier as WithExportKind).exportKind !== 'type',
        );

        if (valueSpecifiers.length === 0) return;

        context.report({ node, messageId: 'registryImport' });
      },

      ExportAllDeclaration(node) {
        if ((node as WithExportKind).exportKind === 'type') return;
        if (!isRegistrySource(node.source.value)) return;

        context.report({ node, messageId: 'registryImport' });
      },

      ImportExpression(node) {
        if (!isRegistrySource(importExpressionSource(node as Linked))) return;

        context.report({ node, messageId: 'registryImport' });
      },
    };
  },
};
