import { describe, expect, test } from 'vitest';
import { generateBB26 } from './utils';

describe('generateBB26', () => {
  test('maps 0-25 to single letters a-z', () => {
    expect(generateBB26(0)).toBe('a');
    expect(generateBB26(1)).toBe('b');
    expect(generateBB26(25)).toBe('z');
  });

  test('rolls over to two letters after z', () => {
    expect(generateBB26(26)).toBe('aa');
    expect(generateBB26(27)).toBe('ab');
    expect(generateBB26(51)).toBe('az');
    expect(generateBB26(52)).toBe('ba');
  });

  test('rolls over to three letters after zz', () => {
    // 'do', 'if' and 'in' are skipped below this point, so the sequence
    // reaches 'zz' three indices earlier than raw bijective base-26.
    expect(generateBB26(698)).toBe('zz');
    expect(generateBB26(699)).toBe('aaa');
  });

  test('generates unique names for a contiguous range', () => {
    const names = new Set<string>();

    for (let i = 0; i < 1000; i++) {
      names.add(generateBB26(i));
    }

    expect(names.size).toBe(1000);
  });

  test('never emits a reserved word', () => {
    // `var do = ...` is a SyntaxError that kills the whole inline script —
    // this regression took every client translation down in production once
    // the chunk count reached the raw-bb26 rank of "do".
    const reserved = new Set(['do', 'if', 'in', 'for', 'new', 'try', 'var', 'let']);

    for (let i = 0; i < 20000; i++) {
      expect(reserved.has(generateBB26(i))).toBe(false);
    }
  });

  test('skips reserved words without gaps or duplicates', () => {
    // raw rank of "do" is 118 ('d'=3, 'o'=14 → 26 + 3*26 + 14); the sequence
    // must step over it and stay contiguous.
    expect(generateBB26(117)).toBe('dn');
    expect(generateBB26(118)).toBe('dp');

    const names = new Set(Array.from({ length: 300 }, (_, i) => generateBB26(i)));
    expect(names.size).toBe(300);
  });
});
