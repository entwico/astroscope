import type { Rule } from 'eslint';

/**
 * `useWormhole` is a React hook — it can only run inside a React component
 * render. Astro frontmatter is server code with no React runtime; the server
 * read is `wormholes.<name>.get()`.
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

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'useWormhole'
          ) {
            context.report({ node: specifier, messageId: 'useWormholeInAstro' });
          }
        }
      },
    };
  },
};
