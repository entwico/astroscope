import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

export interface PluginDocs {
  description: string;
  recommended?: boolean;
  requiresTypeChecking?: boolean;
}

const createRule = ESLintUtils.RuleCreator<PluginDocs>(
  (name) => `https://github.com/entwico/astroscope/tree/main/packages/eslint-plugin#${name}`,
);

type AstroHTMLComment = {
  type: 'AstroHTMLComment';
  value: string;
  range: [number, number];
};

function isHtmlComment(node: unknown): node is AstroHTMLComment {
  return typeof node === 'object' && node !== null && (node as { type?: string }).type === 'AstroHTMLComment';
}

export const noHtmlComments = createRule({
  name: 'no-html-comments',
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow HTML comments (`<!-- -->`) in .astro templates. HTML comments render into the final output and can leak server-side context to the browser; JSX-style `{/* */}` comments are compile-time only.',
    },
    messages: {
      htmlComment:
        'HTML comment renders into the output HTML and is visible to clients. Use a JSX comment (`{/* */}`) instead.',
    },
    fixable: 'code',
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      AstroHTMLComment(rawNode: unknown) {
        if (!isHtmlComment(rawNode)) return;

        const [start, end] = rawNode.range;
        const { value } = rawNode;

        // JSX block comments terminate at `*/`, so if the HTML comment body
        // contains `*/` we can't safely rewrite it. report without a fix.
        const canAutofix = !value.includes('*/');

        context.report({
          node: rawNode as unknown as TSESTree.Node,
          messageId: 'htmlComment',
          ...(canAutofix && {
            fix: (fixer) => fixer.replaceTextRange([start, end], `{/*${value}*/}`),
          }),
        });
      },
    };
  },
});
