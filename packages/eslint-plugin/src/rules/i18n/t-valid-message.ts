import type { Rule } from 'eslint';
import { DefaultFunctions, DraftFunctions } from 'messageformat/functions';
import { analyzeMessage, readMessageSource } from './message.js';
import { isTranslateCall } from './translate-call.js';

// the function set `@astroscope/i18n` compiles messages with
const KNOWN_FUNCTIONS = new Set([...Object.keys(DefaultFunctions), ...Object.keys(DraftFunctions)]);
const KNOWN_FUNCTIONS_LIST = [...KNOWN_FUNCTIONS].toSorted((a, b) => a.localeCompare(b)).map((name) => `:${name}`).join(', ');

export const tValidMessage: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require `t()` and `rich()` fallbacks to be valid MessageFormat 2 messages',
    },
    messages: {
      invalidMessage:
        'the fallback is not a valid MessageFormat 2 message ({{ detail }}). It would be rendered as raw text.',
      unknownFunction:
        'unknown MessageFormat 2 function `:{{ name }}`. Available: {{ known }}.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isTranslateCall(node.callee)) return;

        const source = readMessageSource(node);

        if (!source) return;

        const analysis = analyzeMessage(source.text);

        for (const problem of analysis.problems) {
          context.report({ node: source.node, messageId: 'invalidMessage', data: { detail: problem.detail } });
        }

        for (const name of analysis.functions) {
          if (KNOWN_FUNCTIONS.has(name)) continue;

          context.report({
            node: source.node,
            messageId: 'unknownFunction',
            data: { name, known: KNOWN_FUNCTIONS_LIST },
          });
        }
      },
    };
  },
};
