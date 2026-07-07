import { describe, expect, test } from 'vitest';

import { compileMessage, compileTranslations } from './compiler.js';

describe('compileMessage', () => {
  test('compiles simple text', () => {
    const fn = compileMessage('en', 'Hello World');

    expect(fn()).toBe('Hello World');
  });

  test('compiles variable interpolation without bidi isolation characters', () => {
    const fn = compileMessage('en', 'Hello {$name}');

    expect(fn({ name: 'World' })).toBe('Hello World');
  });

  test('compiles plural', () => {
    const msg = `.input {$count :number}
.match $count
one {{{$count} item}}
* {{{$count} items}}`;
    const fn = compileMessage('en', msg);

    expect(fn({ count: 1 })).toContain('1');
    expect(fn({ count: 1 })).toContain('item');
    expect(fn({ count: 5 })).toContain('5');
    expect(fn({ count: 5 })).toContain('items');
  });

  test('returns raw message on parse error', () => {
    const fn = compileMessage('en', 'Invalid {{{syntax');

    expect(fn()).toBe('Invalid {{{syntax');
  });

  test('caches compiled messages', () => {
    const fn1 = compileMessage('en', 'test');
    const fn2 = compileMessage('en', 'test');

    // both should return the same result
    expect(fn1()).toBe(fn2());
  });
});

describe('compileTranslations', () => {
  test('compiles multiple translations', () => {
    const raw = {
      key1: 'Hello',
      key2: 'World',
    };

    const compiled = compileTranslations('en', raw);

    expect(compiled['key1']?.()).toBe('Hello');
    expect(compiled['key2']?.()).toBe('World');
  });
});
