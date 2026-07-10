import type { Rule } from 'eslint';

const DIRECTIVE_MAP: Record<string, string> = {
  load: 'load-x',
  visible: 'visible-x',
  idle: 'idle-x',
  media: 'media-x',
  only: 'only-x',
};

export const preferXDirectives: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'prefer `client:*-x` directives over `client:*` for i18n-aware hydration',
    },
    messages: {
      preferX:
        'Use `client:{{ replacement }}` instead of `client:{{ original }}`. The -x variant preloads translations before hydration.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node: any) {
        const name = node.name;

        if (!name || name.type !== 'JSXNamespacedName') return;
        if (name.namespace?.name !== 'client') return;

        const directiveName: string = name.name?.name;
        const replacement = DIRECTIVE_MAP[directiveName];

        if (!replacement) return;

        context.report({
          node,
          messageId: 'preferX',
          data: { original: directiveName, replacement },
          fix(fixer) {
            return fixer.replaceText(name.name, replacement);
          },
        });
      },
    };
  },
};
