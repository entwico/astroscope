import { describe, expect, test } from 'vitest';
import { inlineTrack } from './inline.js';
import './test-destinations.js';

describe('inlineTrack', () => {
  test('pushes the event into the queue, creating it when needed', () => {
    const script = inlineTrack({ key: 'viewProduct', event: { a: 'view 1' } });
    const self: { __relay__?: { q: unknown[] } } = {};

    // eslint-disable-next-line no-new-func -- the inline script runs as written
    new Function('self', script)(self);

    expect(self.__relay__?.q).toEqual([{ key: 'viewProduct', event: { a: 'view 1' } }]);
  });

  test('never closes the script tag it is written into', () => {
    const script = inlineTrack({ a: '</script><script>alert(1)</script>' });

    expect(script.toLowerCase()).not.toContain('</script');
    expect(script).toContain(String.raw`\u003c/script`);
  });
});
