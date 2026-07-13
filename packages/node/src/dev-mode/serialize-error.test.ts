import { describe, expect, test } from 'vitest';
import { serializeError } from './serialize-error';

describe('serializeError', () => {
  test('returns the stack for errors', () => {
    const error = new Error('boom');

    const serialized = serializeError(error);

    expect(serialized).toBe(error.stack);
    expect(serialized).toContain('boom');
  });

  test('falls back to the message when the error has no stack', () => {
    const error = new Error('no stack here');

    delete error.stack;

    expect(serializeError(error)).toBe('no stack here');
  });

  test('serializes non-error values as JSON', () => {
    expect(serializeError('plain failure')).toBe('"plain failure"');
    expect(serializeError({ code: 42 })).toBe('{"code":42}');
    expect(serializeError(null)).toBe('null');
  });
});
