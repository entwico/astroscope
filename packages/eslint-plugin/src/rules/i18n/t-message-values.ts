import type { Rule } from 'eslint';
import type { CallExpression } from 'estree';
import { type MessageAnalysis, analyzeMessage, readMessageSource, readMeta, readPassedNames, readStaticObject } from './message.js';
import { isTranslateCall } from './translate-call.js';

// t(key, meta, values) / rich(key, meta, components, values)
function valuesIndex(node: CallExpression): number {
  return node.callee.type === 'Identifier' && node.callee.name === 'rich' ? 3 : 2;
}

export const tMessageValues: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require the values passed to `t()` and `rich()` to match the variables of the fallback message',
    },
    messages: {
      missingValue:
        'the message uses the variable `{{ name }}` but no such value is passed.',
      unusedValue:
        'the value `{{ name }}` is not used by the message.',
      literalPlaceholder:
        'the value `{{ name }}` is not used by the message: `{{{ name }}}` is literal text, a variable takes a `$` prefix.',
      unknownMetaVariable:
        'the `variables` meta describes `{{ name }}`, which the message does not use.',
    },
    schema: [],
  },
  create(context) {
    const checkMetaVariables = (node: CallExpression, analysis: MessageAnalysis) => {
      const described = readStaticObject(readMeta(node)?.properties.get('variables')?.value);
      const describedProperties = described?.properties ?? [];

      for (const [name, prop] of describedProperties) {
        if (!analysis.variables.has(name)) {
          context.report({ node: prop.key, messageId: 'unknownMetaVariable', data: { name } });
        }
      }
    };

    return {
      CallExpression(node) {
        if (!isTranslateCall(node.callee)) return;

        const source = readMessageSource(node);

        if (!source) return;

        const analysis = analyzeMessage(source.text);

        // an invalid message has no variables to compare with — t-valid-message reports it
        if (analysis.problems.length > 0) return;

        checkMetaVariables(node, analysis);

        const argument = node.arguments[valuesIndex(node)];
        const values = readStaticObject(argument);
        const passed = values?.properties ?? [];

        for (const [name, prop] of passed) {
          if (analysis.variables.has(name)) continue;

          context.report({
            node: prop.key,
            messageId: analysis.literalPlaceholders.has(name) ? 'literalPlaceholder' : 'unusedValue',
            data: { name },
          });
        }

        const names = readPassedNames(context, argument);

        if (!names) return;

        for (const name of analysis.variables) {
          if (!names.has(name)) {
            context.report({ node: argument ?? node, messageId: 'missingValue', data: { name } });
          }
        }
      },
    };
  },
};
