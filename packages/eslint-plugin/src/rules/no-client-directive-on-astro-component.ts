import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

import { type PluginDocs, isClientDirective } from '../utils/island.js';

const createRule = ESLintUtils.RuleCreator<PluginDocs>(
  (name) => `https://github.com/entwico/astroscope/tree/main/packages/eslint-plugin#${name}`,
);

export const noClientDirectiveOnAstroComponent = createRule<[], 'astroIsland'>({
  name: 'no-client-directive-on-astro-component',
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow `client:*` directives on Astro components (imported from `.astro`). Client directives only hydrate framework components; on an Astro component they have no effect.',
    },
    messages: {
      astroIsland:
        '`{{directive}}` has no effect on the Astro component <{{comp}}> — client directives only hydrate framework (React/Vue/Svelte/…) components.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    // local names imported from a `.astro` module
    const astroComponents = new Set<string>();

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        if (typeof node.source.value !== 'string' || !node.source.value.endsWith('.astro')) {
          return;
        }

        for (const specifier of node.specifiers) {
          astroComponents.add(specifier.local.name);
        }
      },

      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        const tag = node.name;

        if (tag.type !== 'JSXIdentifier' || !astroComponents.has(tag.name)) {
          return;
        }

        for (const attr of node.attributes) {
          if (isClientDirective(attr) && attr.type === 'JSXAttribute' && attr.name.type === 'JSXNamespacedName') {
            context.report({
              node: attr,
              messageId: 'astroIsland',
              data: {
                directive: `client:${attr.name.name.name}`,
                comp: tag.name,
              },
            });
          }
        }
      },
    };
  },
});
