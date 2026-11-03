import { describe, expect, test } from 'vitest';
import { OTEL_REDACTED_QUERY_PARAMS, redactQuery } from './redact-query';

describe('redactQuery', () => {
  const defaults = new Set(OTEL_REDACTED_QUERY_PARAMS);

  test('replaces the values of the named parameters and keeps the rest as sent', () => {
    expect(redactQuery('a=1&sig=s3cr3t&X-Goog-Signature=abc&b=%20x', defaults)).toBe(
      'a=1&sig=REDACTED&X-Goog-Signature=REDACTED&b=%20x',
    );
  });

  test('matches keys case-sensitively and leaves bare keys alone', () => {
    expect(redactQuery('SIG=1&sig&Signature=2', defaults)).toBe('SIG=1&sig=REDACTED&Signature=REDACTED');
  });

  test('an empty query or an empty list is a no-op', () => {
    expect(redactQuery('', defaults)).toBe('');
    expect(redactQuery('sig=1', new Set())).toBe('sig=1');
  });
});
