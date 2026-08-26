import type { Rule } from 'eslint';
import type { Node } from 'estree';

/**
 * Astro files are server code (frontmatter and template expressions run during
 * render) — wormhole values there are request-scoped and read-only. `set()`
 * throws at runtime and `subscribe()` is an inert no-op; both are client-only.
 * Covers both the `wormholes` proxy and a registry imported under that name.
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

    const specifiers: Node[] = [];

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'wormholes'
          ) {
            specifiers.push(specifier);
          }
        }
      },

      'Program:exit'() {
        for (const specifier of specifiers) {
          for (const variable of context.sourceCode.getDeclaredVariables(specifier)) {
            for (const reference of variable.references) {
              const identifier = reference.identifier as Node & { parent?: Node };
              const wormhole = identifier.parent;

              // wormholes.<name>.set(...) — identifier → member → member → call
              if (wormhole?.type !== 'MemberExpression' || wormhole.object !== identifier) continue;

              const access = (wormhole as Node & { parent?: Node }).parent;

              if (access?.type !== 'MemberExpression' || access.object !== wormhole || access.computed) continue;
              if (access.property.type !== 'Identifier') continue;

              const call = (access as Node & { parent?: Node }).parent;

              if (call?.type !== 'CallExpression' || call.callee !== access) continue;

              if (access.property.name === 'set') {
                context.report({ node: call, messageId: 'serverSet' });
              } else if (access.property.name === 'subscribe') {
                context.report({ node: call, messageId: 'serverSubscribe' });
              }
            }
          }
        }
      },
    };
  },
};
