import type { Rule } from 'eslint';
import type { Node } from 'estree';
import { type Linked, callOf, memberName, memberOff } from '../../utils/ast.js';

/**
 * Astro files are server code (frontmatter and template expressions run during
 * render) — wormhole values there are request-scoped and read-only. `set()`
 * throws at runtime and `subscribe()` is an inert no-op; both are client-only.
 * Covers both the `wormholes` proxy and a registry imported under that name,
 * reached directly or through a namespace import (`W.wormholes`); computed
 * members with a static key and typescript wrappers read like the plain form.
 */
export const serverReadonly: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'forbid client-only wormhole calls (`set`, `subscribe`) in astro server code',
    },
    messages: {
      serverSet:
        '`set()` is client-only — astro files are server code, where wormhole values are request-scoped and provided by the middleware.',
      serverSubscribe:
        '`subscribe()` is client-only — server values never change within a request, so this subscription would never fire.',
    },
    schema: [],
  },
  create(context) {
    if (!context.filename.endsWith('.astro')) return {};

    const registries: Node[] = [];
    const namespaces: Node[] = [];

    // wormholes.<name>.set(...) — registry → member → member → call
    const reportClientCalls = (registry: Linked): void => {
      const wormhole = memberOff(registry);
      const access = wormhole && memberOff(wormhole);
      const method = access && memberName(access);
      const call = access && callOf(access);

      if (!call) return;

      if (method === 'set') {
        context.report({ node: call, messageId: 'serverSet' });
      } else if (method === 'subscribe') {
        context.report({ node: call, messageId: 'serverSubscribe' });
      }
    };

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaces.push(specifier);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'wormholes'
          ) {
            registries.push(specifier);
          }
        }
      },

      'Program:exit'() {
        for (const specifier of registries) {
          for (const variable of context.sourceCode.getDeclaredVariables(specifier)) {
            for (const reference of variable.references) {
              reportClientCalls(reference.identifier as Linked);
            }
          }
        }

        for (const specifier of namespaces) {
          for (const variable of context.sourceCode.getDeclaredVariables(specifier)) {
            for (const reference of variable.references) {
              const registry = memberOff(reference.identifier as Linked);

              if (registry && memberName(registry) === 'wormholes') {
                reportClientCalls(registry);
              }
            }
          }
        }
      },
    };
  },
};
