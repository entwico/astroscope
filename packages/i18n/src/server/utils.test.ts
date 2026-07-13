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
    expect(generateBB26(701)).toBe('zz');
    expect(generateBB26(702)).toBe('aaa');
  });

  test('generates unique names for a contiguous range', () => {
    const names = new Set<string>();

    for (let i = 0; i < 1000; i++) {
      names.add(generateBB26(i));
    }

    expect(names.size).toBe(1000);
  });
});
