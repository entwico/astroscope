import type { Rule } from 'eslint';

export const noModuleLevelT: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'forbid `t()` calls at module level (outside functions)',
    },
    messages: {
      moduleLevelT:
        '`t()` must not be called at module level. It requires request context (server) or hydrated translations (client). Move it inside a function or component.',
    },
    schema: [],
  },
  create(context) {
    if (context.filename.endsWith('.astro')) return {};

    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 't') return;

        // walk up the scope chain — if we never hit a function boundary, it's module-level
        let scope = context.sourceCode.getScope(node);

        while (scope) {
          if (scope.type === 'function') return;
          scope = scope.upper!;
        }

        context.report({ node, messageId: 'moduleLevelT' });
      },
    };
  },
};
