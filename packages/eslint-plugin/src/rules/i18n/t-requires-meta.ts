import type { Rule } from 'eslint';

export const tRequiresMeta: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'require the second argument (fallback/meta) in `t()` calls',
    },
    messages: {
      missingMeta:
        '`t()` should include a fallback as the second argument for development DX. Use `t(key, "fallback")` or `t(key, { fallback: "..." })`.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 't') return;
        if (node.arguments.length < 1) return; // no key — other rules handle this

        if (node.arguments.length < 2) {
          context.report({ node, messageId: 'missingMeta' });
        }
      },
    };
  },
};
