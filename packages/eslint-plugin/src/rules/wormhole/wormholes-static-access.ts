import type { Rule } from 'eslint';
import type { Node } from 'estree';

/**
 * The build-time scanner resolves `wormholes.<name>` member accesses to decide
 * which wormholes each chunk needs. Anything it cannot resolve statically —
 * computed access with a non-literal key, or the proxy escaping into a variable —
 * degrades the whole chunk to "all open wormholes". That is sound but defeats
 * slicing, so make it visible.
 */
export const wormholesStaticAccess: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'require static member access on the `wormholes` proxy so build-time slicing stays precise',
    },
    messages: {
      dynamicAccess:
        'dynamic wormhole access cannot be resolved at build time — every island in this chunk will receive all open wormholes. Use a static name: `wormholes.cart`.',
      aliasedProxy:
        'aliasing the `wormholes` proxy hides its accesses from the build-time scanner — every island in this chunk will receive all open wormholes. Access it directly: `wormholes.<name>`.',
    },
    schema: [],
  },
  create(context) {
    // .astro code is server-rendered and never enters the client chunk graph
    if (context.filename.endsWith('.astro')) return {};

    const specifiers: Node[] = [];

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@astroscope/wormhole') return;

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

      // references are inspected after the full AST is traversed, so parent links exist
      'Program:exit'() {
        for (const specifier of specifiers) {
          for (const variable of context.sourceCode.getDeclaredVariables(specifier)) {
            for (const reference of variable.references) {
              const identifier = reference.identifier as Node & { parent?: Node };
              const parent = identifier.parent;

              if (parent?.type === 'MemberExpression' && parent.object === identifier) {
                if (!parent.computed) continue;
                if (parent.property.type === 'Literal' && typeof parent.property.value === 'string') continue;

                context.report({ node: parent, messageId: 'dynamicAccess' });
              } else {
                context.report({ node: identifier, messageId: 'aliasedProxy' });
              }
            }
          }
        }
      },
    };
  },
};
