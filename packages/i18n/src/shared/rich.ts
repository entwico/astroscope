import type { MessageMarkupPart, MessagePart } from 'messageformat';

// MessagePart<string> covers all built-in part types
type Part = MessagePart<string>;

/**
 * Component callbacks for rich text rendering.
 * Each key maps to a function that wraps children in a component.
 *
 * @example
 * ```tsx
 * const components: RichComponents = {
 *   link: (children) => <a href="/tos">{children}</a>,
 *   bold: (children) => <strong>{children}</strong>,
 * };
 * ```
 */
export type RichComponents<T = unknown> = Record<string, (children: (string | T)[]) => T>;

type StackFrame<T> = {
  name: string;
  children: (string | T)[];
};

// react element symbols - Symbol.for() returns the same symbol React uses internally
const REACT_ELEMENT_TYPE = Symbol.for('react.element');
const REACT_TRANSITIONAL_ELEMENT_TYPE = Symbol.for('react.transitional.element');

type ReactElementLike = {
  $$typeof: symbol;
  key: string | null;
};

/**
 * Duck-type check for React elements without importing React.
 * Uses Symbol.for() which returns the same symbol React uses internally.
 */
function isReactElement(value: unknown): value is ReactElementLike {
  if (typeof value !== 'object' || value === null || !('$$typeof' in value)) {
    return false;
  }

  const type = (value as ReactElementLike).$$typeof;

  return type === REACT_ELEMENT_TYPE || type === REACT_TRANSITIONAL_ELEMENT_TYPE;
}

/**
 * Add a key to a React element if it doesn't have one.
 * Creates a shallow copy since React elements are frozen.
 */
function addKeyIfNeeded<T>(element: T, key: string): T {
  if (isReactElement(element) && element.key === null) {
    return { ...element, key } as T;
  }

  return element;
}

function isMarkupPart(part: Part): part is MessageMarkupPart {
  return part.type === 'markup';
}

function applyMarkupPart<T>(
  part: MessageMarkupPart,
  stack: StackFrame<T>[],
  result: (string | T)[],
  components: RichComponents<T>,
  nextKey: () => string,
): void {
  const target = stack.length > 0 ? stack.at(-1)!.children : result;

  switch (part.kind) {
    case 'open': {
      stack.push({ name: part.name, children: [] });

      break;
    }

    case 'close': {
      const frame = stack.pop();

      if (!frame) {
        // mismatched close tag, ignore
        break;
      }

      const component = components[frame.name];
      const parent = stack.length > 0 ? stack.at(-1)!.children : result;

      if (component) {
        parent.push(addKeyIfNeeded(component(frame.children), nextKey()));
      } else {
        // no component for this tag, just flatten children
        parent.push(...frame.children);
      }

      break;
    }

    case 'standalone': {
      // self-closing: {#icon/}
      const component = components[part.name];

      if (component) {
        target.push(addKeyIfNeeded(component([]), nextKey()));
      }

      break;
    }
  }
}

/**
 * Convert MF2 formatToParts() output to a tree of nodes.
 * Works with any JSX runtime (Astro, React, etc.) - the callbacks
 * return whatever JSX elements the active runtime compiles to.
 *
 * @example
 * MF2 message: "Read our {#link}Terms{/link}"
 * Parts: [
 *   { type: 'text', value: 'Read our ' },
 *   { type: 'markup', kind: 'open', name: 'link' },
 *   { type: 'text', value: 'Terms' },
 *   { type: 'markup', kind: 'close', name: 'link' },
 * ]
 * Result: ['Read our ', <a href="/tos">Terms</a>]
 */
export function partsToNodes<T>(parts: Part[], components: RichComponents<T>): (string | T)[] {
  const result: (string | T)[] = [];
  const stack: StackFrame<T>[] = [];
  let keyIndex = 0;
  const nextKey = () => `rich-${keyIndex++}`;

  for (const part of parts) {
    const target = stack.length > 0 ? stack.at(-1)!.children : result;

    if (isMarkupPart(part)) {
      applyMarkupPart(part, stack, result, components, nextKey);
    } else if (part.type === 'text') {
      // plain text content - MessageTextPart.value is a string
      target.push(part.value as string);
    } else if (part.type === 'bidiIsolation') {
      // BiDi isolates - skip them (they're control characters for text direction)
      // could optionally include them for proper BiDi handling
    } else {
      // handle other part types (number, string, fallback, unknown, etc.)
      // they all have a value property we can stringify
      if ('value' in part && part.value !== undefined && part.value !== null) {
        const stringValue = String(part.value);

        target.push(stringValue);
      }
    }
  }

  // handle unclosed tags by flattening remaining stack frames
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const parent = stack.length > 0 ? stack.at(-1)!.children : result;

    parent.push(...frame.children);
  }

  return result;
}
