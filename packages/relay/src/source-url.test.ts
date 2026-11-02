import { describe, expect, test } from 'vitest';
import { withoutQuery } from './source-url.js';

describe('withoutQuery', () => {
  test('keeps origin and path, drops query and fragment', () => {
    expect(withoutQuery('https://example.com/newsletter/profile?id=1&token=secret#top')).toBe('https://example.com/newsletter/profile');
    expect(withoutQuery('https://example.com/')).toBe('https://example.com/');
  });

  test('leaves what is no url alone', () => {
    expect(withoutQuery('not a url')).toBe('not a url');
  });
});
