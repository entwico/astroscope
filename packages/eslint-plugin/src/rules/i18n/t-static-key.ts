import type { Rule } from 'eslint';

export const tStaticKey: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require the first argument of `t()` to be a static string literal',
    },
    messages: {
      dynamicKey: '`t()` key must be a static string literal. Dynamic keys cannot be extracted at build time.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 't') return;

        const firstArg = node.arguments[0];

        if (!firstArg) return; // no args — other rules handle this

        // allow string literals
        if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') return;

        // allow template literals with no expressions: `checkout.title`
        if (firstArg.type === 'TemplateLiteral' && firstArg.expressions.length === 0) return;

        context.report({ node: firstArg, messageId: 'dynamicKey' });
      },
    };
  },
};
