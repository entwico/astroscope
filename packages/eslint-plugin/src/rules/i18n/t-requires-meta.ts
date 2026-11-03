import type { Rule } from 'eslint';
import { isTranslateCall } from './translate-call.js';

export const tRequiresMeta: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'require the second argument (fallback/meta) in `t()` and `rich()` calls',
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
        if (!isTranslateCall(node.callee)) return;
        if (node.arguments.length === 0) return; // no key — other rules handle this

        if (node.arguments.length < 2) {
          context.report({ node, messageId: 'missingMeta' });
        }
      },
    };
  },
};
