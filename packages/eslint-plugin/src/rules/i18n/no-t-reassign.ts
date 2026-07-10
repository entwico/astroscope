import type { Rule } from 'eslint';

export const noTReassign: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'forbid aliasing or reassigning the `t` function',
    },
    messages: {
      noAlias: 'Do not alias `t` to another name. The build-time extractor only recognizes `t()` calls.',
      noReassign: 'Do not reassign `t`. The build-time extractor only recognizes the original `t()` import.',
    },
    schema: [],
  },
  create(context) {
    let tImported = false;

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          if (specifier.imported.type !== 'Identifier') continue;
          if (specifier.imported.name !== 't') continue;

          tImported = true;

          // import { t as translate } from '...'
          if (specifier.local.name !== 't') {
            context.report({ node: specifier, messageId: 'noAlias' });
          }
        }
      },

      // const translate = t
      VariableDeclarator(node) {
        if (!tImported) return;
        if (node.init?.type !== 'Identifier' || node.init.name !== 't') return;

        context.report({ node, messageId: 'noReassign' });
      },

      // translate = t
      AssignmentExpression(node) {
        if (!tImported) return;
        if (node.right.type !== 'Identifier' || node.right.name !== 't') return;

        context.report({ node, messageId: 'noReassign' });
      },
    };
  },
};
