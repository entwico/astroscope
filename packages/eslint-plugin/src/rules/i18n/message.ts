import type { Rule } from 'eslint';
import type { CallExpression, Node, ObjectExpression, Property } from 'estree';
import { type Model, parseMessage, validate, visit } from 'messageformat';
import { unwrapInward } from '../../utils/ast.js';
import { type TypedNames, readTypedNames } from './typed-names.js';

export type MessageProblem = {
  /** the parser's or validator's error code, e.g. `parse-error` or `missing-fallback` */
  type: string;
  detail: string;
};

export type MessageAnalysis = {
  /** variables the message reads from the caller's values (`.local` names are not among them) */
  variables: Set<string>;
  /** function names of every annotation, e.g. `number` for `{$count :number}` */
  functions: Set<string>;
  /** markup tags in source order, every variant included */
  markup: Model.Markup[];
  /** bare literal placeholders such as `{name}` — rendered as the text `name`, never as a variable */
  literalPlaceholders: Set<string>;
  problems: MessageProblem[];
};

export type StaticObject = {
  node: ObjectExpression;
  properties: Map<string, Property>;
  /** a spread or computed key hides further names, so absence proves nothing */
  open: boolean;
};

export type MessageSource = {
  node: Node;
  text: string;
};

const cache = new Map<string, MessageAnalysis>();

/** the static value of a string literal or an expression-free template literal */
export function staticString(node: Node | undefined): string | undefined {
  if (!node) return undefined;

  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }

  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }

  return undefined;
}

export function propertyName(prop: Property): string | undefined {
  if (prop.computed) return undefined;

  if (prop.key.type === 'Identifier') return prop.key.name;

  return prop.key.type === 'Literal' && typeof prop.key.value === 'string' ? prop.key.value : undefined;
}

/** reads an inline object literal; `undefined` for anything the rule cannot see into (an identifier, a call) */
export function readStaticObject(node: Node | undefined): StaticObject | undefined {
  const value = node && unwrapInward(node);

  if (value?.type !== 'ObjectExpression') return undefined;

  const properties = new Map<string, Property>();
  let open = false;

  for (const prop of value.properties) {
    const name = prop.type === 'Property' ? propertyName(prop) : undefined;

    if (name === undefined || prop.type !== 'Property') {
      open = true;
    } else {
      properties.set(name, prop);
    }
  }

  return { node: value, properties, open };
}

/**
 * The names a values / components argument provides: none when it is left out, the keys of an inline
 * object literal, else the properties of its type. `undefined` when the rule cannot tell.
 */
export function readPassedNames(context: Rule.RuleContext, node: Node | undefined): TypedNames | undefined {
  if (!node || (node.type === 'Identifier' && node.name === 'undefined')) {
    return { has: () => false };
  }

  const literal = readStaticObject(node);

  return literal && !literal.open ? literal.properties : readTypedNames(context, node);
}

/** the meta argument as an object literal, when it is written in the object form */
export function readMeta(call: CallExpression): StaticObject | undefined {
  return readStaticObject(call.arguments[1]);
}

/** the fallback message of a `t()` / `rich()` call, when it is statically readable */
export function readMessageSource(call: CallExpression): MessageSource | undefined {
  const meta = call.arguments[1];

  if (!meta || meta.type === 'SpreadElement') return undefined;

  const shorthand = staticString(meta);

  if (shorthand !== undefined) {
    return { node: meta, text: shorthand };
  }

  const fallback = readMeta(call)?.properties.get('fallback')?.value;
  const text = staticString(fallback);

  return fallback && text !== undefined ? { node: fallback, text } : undefined;
}

function analyze(text: string): MessageAnalysis {
  const analysis: MessageAnalysis = {
    variables: new Set(),
    functions: new Set(),
    markup: [],
    literalPlaceholders: new Set(),
    problems: [],
  };

  let message: Model.Message;

  try {
    message = parseMessage(text);
  } catch (error) {
    const { type, message: detail } = error as { type?: string; message?: string };

    analysis.problems.push({ type: type ?? 'parse-error', detail: detail ?? String(error) });

    return analysis;
  }

  const { variables, functions } = validate(message, (type) => {
    analysis.problems.push({ type, detail: type });
  });

  analysis.variables = variables;
  analysis.functions = functions;

  visit(message, {
    markup: (markup) => {
      analysis.markup.push(markup);
    },
    expression: (expression, context) => {
      if (context === 'placeholder' && expression.arg?.type === 'literal' && !expression.functionRef) {
        analysis.literalPlaceholders.add(expression.arg.value);
      }
    },
  });

  return analysis;
}

export function analyzeMessage(text: string): MessageAnalysis {
  let analysis = cache.get(text);

  if (!analysis) {
    analysis = analyze(text);
    cache.set(text, analysis);
  }

  return analysis;
}
