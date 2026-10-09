import type { Rule } from 'eslint';
import type { Node, ObjectExpression, Property } from 'estree';

// a meta string is non-extractable when built via `+` concatenation, an interpolated template
// literal or a tagged template (`String.raw`) — the build cannot read any of them statically
function dynamicStringMessage(node: Node): 'dynamicMeta' | 'taggedMeta' | undefined {
  if ((node.type === 'BinaryExpression' && node.operator === '+') ||
    (node.type === 'TemplateLiteral' && node.expressions.length > 0)) {
    return 'dynamicMeta';
  }

  if (node.type === 'TaggedTemplateExpression') {
    return 'taggedMeta';
  }

  return undefined;
}

function findProperty(obj: ObjectExpression, name: string): Property | undefined {
  for (const prop of obj.properties) {
    if (prop.type !== 'Property' || prop.computed) continue;

    if (
      (prop.key.type === 'Identifier' && prop.key.name === name) ||
      (prop.key.type === 'Literal' && prop.key.value === name)
    ) {
      return prop;
    }
  }

  return undefined;
}

export const tStaticMeta: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require `t()` fallback and description strings to be static string literals',
    },
    messages: {
      dynamicMeta:
        '`t()` {{ field }} must be a static string literal. String concatenation and template expressions cannot be extracted at build time — use an MF2 template with variables instead, e.g. `t(key, "Hello {name}", { name })`.',
      taggedMeta:
        '`t()` {{ field }} must be a plain string literal. A tagged template such as `String.raw` is a call the extractor cannot evaluate at build time — write the escapes in a plain string instead.',
    },
    schema: [],
  },
  create(context) {
    const checkField = (obj: ObjectExpression, field: string) => {
      const prop = findProperty(obj, field);
      const messageId = prop && dynamicStringMessage(prop.value);

      if (prop && messageId) {
        context.report({ node: prop.value, messageId, data: { field } });
      }
    };

    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 't') return;

        const meta = node.arguments[1];

        if (!meta) return; // no fallback — other rules handle this

        // string shorthand: t('key', 'a' + b)
        const messageId = dynamicStringMessage(meta);

        if (messageId) {
          context.report({ node: meta, messageId, data: { field: 'fallback' } });

          return;
        }

        if (meta.type !== 'ObjectExpression') return;

        // top-level fallback / description
        checkField(meta, 'fallback');
        checkField(meta, 'description');

        // per-variable fallback / description
        const variables = findProperty(meta, 'variables');

        if (variables && variables.value.type === 'ObjectExpression') {
          for (const varProp of variables.value.properties) {
            if (varProp.type !== 'Property' || varProp.value.type !== 'ObjectExpression') continue;

            checkField(varProp.value, 'fallback');
            checkField(varProp.value, 'description');
          }
        }
      },
    };
  },
};
