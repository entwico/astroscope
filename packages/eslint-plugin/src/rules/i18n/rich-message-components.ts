import type { Rule } from 'eslint';
import type { Model } from 'messageformat';
import { analyzeMessage, readMessageSource, readPassedNames, readStaticObject } from './message.js';

// `rich()` pairs tags the way a stack does and flattens whatever is left over
function unbalancedTags(markup: Model.Markup[]): string[] {
  const unbalanced: string[] = [];
  const stack: string[] = [];

  for (const tag of markup) {
    if (tag.kind === 'open') {
      stack.push(tag.name);
    } else if (tag.kind === 'close' && stack.pop() !== tag.name) {
      unbalanced.push(tag.name);
    }
  }

  return [...unbalanced, ...stack];
}

export const richMessageComponents: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require the components passed to `rich()` to match the markup tags of the fallback message',
    },
    messages: {
      missingComponent:
        'the message uses the tag `{#{{ name }}}` but no `{{ name }}` component is passed. Its content would render as plain text.',
      unusedComponent:
        'the component `{{ name }}` is not used by the message.',
      unbalancedTag:
        'the tag `{{ name }}` is not opened and closed in pairs.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'rich') return;

        const source = readMessageSource(node);

        if (!source) return;

        const analysis = analyzeMessage(source.text);

        if (analysis.problems.length > 0) return;

        const unbalanced = new Set(unbalancedTags(analysis.markup));

        for (const name of unbalanced) {
          context.report({ node: source.node, messageId: 'unbalancedTag', data: { name } });
        }

        const argument = node.arguments[2];
        const components = readStaticObject(argument);
        const passed = components?.properties ?? [];
        const tags = new Set(analysis.markup.map((tag) => tag.name));

        for (const [name, prop] of passed) {
          if (!tags.has(name)) {
            context.report({ node: prop.key, messageId: 'unusedComponent', data: { name } });
          }
        }

        const names = readPassedNames(context, argument);

        if (!names) return;

        for (const name of tags) {
          if (!names.has(name)) {
            context.report({ node: argument ?? node, messageId: 'missingComponent', data: { name } });
          }
        }
      },
    };
  },
};
