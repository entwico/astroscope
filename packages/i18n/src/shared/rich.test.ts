import type { MessagePart } from 'messageformat';
import { describe, expect, test } from 'vitest';
import { formatMessageToParts } from './compiler';
import { type RichComponents, partsToNodes } from './rich';

type Part = MessagePart<string>;

const text = (value: string): Part => ({ type: 'text', value });
const open = (name: string): Part => ({ type: 'markup', kind: 'open', name });
const close = (name: string): Part => ({ type: 'markup', kind: 'close', name });
const standalone = (name: string): Part => ({ type: 'markup', kind: 'standalone', name });

type Node = { tag: string; children: (string | Node)[] };

const tag =
  (name: string) =>
  (children: (string | Node)[]): Node => ({ tag: name, children });

describe('partsToNodes', () => {
  test('returns plain text parts as strings', () => {
    expect(partsToNodes([text('Hello'), text(' World')], {})).toEqual(['Hello', ' World']);
  });

  test('wraps markup content with the matching component', () => {
    const parts = [text('Read our '), open('link'), text('Terms'), close('link')];

    const result = partsToNodes<Node>(parts, { link: tag('a') });

    expect(result).toEqual(['Read our ', { tag: 'a', children: ['Terms'] }]);
  });

  test('handles nested markup', () => {
    const parts = [open('outer'), text('a'), open('inner'), text('b'), close('inner'), text('c'), close('outer')];

    const result = partsToNodes<Node>(parts, { outer: tag('div'), inner: tag('em') });

    expect(result).toEqual([{ tag: 'div', children: ['a', { tag: 'em', children: ['b'] }, 'c'] }]);
  });

  test('flattens children when no component matches the tag', () => {
    const parts = [text('a '), open('unknown'), text('b'), close('unknown'), text(' c')];

    expect(partsToNodes(parts, {})).toEqual(['a ', 'b', ' c']);
  });

  test('renders standalone markup with an empty children array', () => {
    const parts = [text('before '), standalone('icon'), text(' after')];

    const result = partsToNodes<Node>(parts, { icon: tag('svg') });

    expect(result).toEqual(['before ', { tag: 'svg', children: [] }, ' after']);
  });

  test('drops standalone markup without a component', () => {
    expect(partsToNodes([text('a'), standalone('icon'), text('b')], {})).toEqual(['a', 'b']);
  });

  test('ignores mismatched close tags', () => {
    expect(partsToNodes([text('a'), close('link'), text('b')], {})).toEqual(['a', 'b']);
  });

  test('flattens unclosed tags at the end', () => {
    const parts = [open('outer'), text('a'), open('inner'), text('b')];

    const result = partsToNodes<Node>(parts, { outer: tag('div'), inner: tag('em') });

    expect(result).toEqual(['a', 'b']);
  });

  test('skips bidi isolation parts', () => {
    const parts = [text('a'), { type: 'bidiIsolation', value: '⁨' } as Part, text('b')];

    expect(partsToNodes(parts, {})).toEqual(['a', 'b']);
  });

  test('stringifies value-bearing parts like numbers', () => {
    const parts = [text('count: '), { type: 'number', value: 5 } as unknown as Part];

    expect(partsToNodes(parts, {})).toEqual(['count: ', '5']);
  });

  test('skips value-bearing parts with nullish values', () => {
    const parts = [text('a'), { type: 'fallback', value: undefined } as unknown as Part];

    expect(partsToNodes(parts, {})).toEqual(['a']);
  });

  test('assigns sequential keys to keyless react elements', () => {
    const element = (children: unknown[]) => ({
      $$typeof: Symbol.for('react.transitional.element'),
      type: 'a',
      key: null,
      props: { children },
    });

    const parts = [open('link'), text('a'), close('link'), open('link'), text('b'), close('link')];
    const components: RichComponents = { link: element };

    const result = partsToNodes(parts, components) as { key: string }[];

    expect(result[0]?.key).toBe('rich-0');
    expect(result[1]?.key).toBe('rich-1');
  });

  test('preserves existing keys on react elements', () => {
    const element = {
      $$typeof: Symbol.for('react.element'),
      type: 'a',
      key: 'custom',
      props: {},
    };

    const result = partsToNodes([open('link'), close('link')], { link: () => element });

    expect(result[0]).toBe(element);
  });

  test('does not add keys to non-react values', () => {
    const value = { tag: 'a', children: [] };

    const result = partsToNodes([open('link'), close('link')], { link: () => value });

    expect(result[0]).toBe(value);
    expect(result[0]).not.toHaveProperty('key');
  });

  test('processes real formatToParts output with markup', () => {
    const parts = formatMessageToParts('en', 'Read our {#link}Terms{/link} today');

    const result = partsToNodes<Node>(parts, { link: tag('a') });

    expect(result).toEqual(['Read our ', { tag: 'a', children: ['Terms'] }, ' today']);
  });
});
