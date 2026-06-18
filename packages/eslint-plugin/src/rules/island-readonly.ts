import { isTypeReadonly } from '@typescript-eslint/type-utils';
import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

import { type PluginDocs, isIslandElement, resolvePropsType } from '../utils/island.js';

const createRule = ESLintUtils.RuleCreator<PluginDocs>(
  (name) => `https://github.com/entwico/astroscope/tree/main/packages/eslint-plugin#${name}`,
);

export const islandReadonly = createRule<[], 'mutable'>({
  name: 'island-readonly',
  meta: {
    type: 'problem',
    docs: {
      description:
        'require the props of a hydrated island (a `client:*` component) to be deeply readonly, so the island cannot mutate server data passed across the boundary.',
      requiresTypeChecking: true,
    },
    messages: {
      mutable:
        'island <{{comp}}> has mutable props — declare them deeply `readonly` so it cannot mutate server data (a renderer that mutates the server cache can poison it).',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    let services: ReturnType<typeof ESLintUtils.getParserServices>;

    try {
      services = ESLintUtils.getParserServices(context);
    } catch {
      return {};
    }

    const checker = services.program.getTypeChecker();

    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        if (!isIslandElement(node)) {
          return;
        }

        const tag = node.name;
        const tsTagNode = services.esTreeNodeToTSNodeMap.get(tag);
        const propsType = resolvePropsType(checker, tsTagNode);

        if (!propsType) {
          return;
        }

        // strict: no allowlist — opaque/non-serializable types can't cross the island boundary anyway
        if (!isTypeReadonly(services.program, propsType)) {
          context.report({ node: tag, messageId: 'mutable', data: { comp: tag.name } });
        }
      },
    };
  },
});
