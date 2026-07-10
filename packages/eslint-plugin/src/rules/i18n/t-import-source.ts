import type { Rule } from 'eslint';

const ALLOWED_SOURCES = ['@astroscope/i18n/translate'];

export const tImportSource: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'enforce that `t` is imported from @astroscope/i18n',
    },
    messages: {
      wrongSource: '`t` must be imported from {{ allowed }}, got "{{ source }}".',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;

        if (typeof source !== 'string') return;

        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 't' &&
            !ALLOWED_SOURCES.includes(source)
          ) {
            context.report({
              node: specifier,
              messageId: 'wrongSource',
              data: {
                source,
                allowed: ALLOWED_SOURCES.join(' or '),
              },
            });
          }
        }
      },
    };
  },
};
