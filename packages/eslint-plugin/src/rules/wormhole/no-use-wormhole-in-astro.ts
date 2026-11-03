import type { Rule } from 'eslint';
import type { Node } from 'estree';
import { type Linked, memberName, memberOff } from '../../utils/ast.js';

/**
 * `useWormhole` is a React hook — it can only run inside a React component
 * render. Astro frontmatter is server code with no React runtime; the server
 * read is `wormholes.<name>.get()`. The named import is reported at the
 * import, a namespace import at every `ns.useWormhole` read.
 */
export const noUseWormholeInAstro: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'forbid the `useWormhole` react hook in astro files',
    },
    messages: {
      useWormholeInAstro:
        '`useWormhole` is a React hook and cannot run in astro server code — read the value with `wormholes.<name>.get()` instead.',
    },
    schema: [],
  },
  create(context) {
    if (!context.filename.endsWith('.astro')) return {};

    const namespaces: Node[] = [];

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaces.push(specifier);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'useWormhole'
          ) {
            context.report({ node: specifier, messageId: 'useWormholeInAstro' });
          }
        }
      },

      'Program:exit'() {
        for (const specifier of namespaces) {
          for (const variable of context.sourceCode.getDeclaredVariables(specifier)) {
            for (const reference of variable.references) {
              const member = memberOff(reference.identifier as Linked);

              if (member && memberName(member) === 'useWormhole') {
                context.report({ node: member, messageId: 'useWormholeInAstro' });
              }
            }
          }
        }
      },
    };
  },
};
