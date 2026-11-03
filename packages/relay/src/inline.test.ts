import { afterEach, describe, expect, test, vi } from 'vitest';
import { RELAY_QUEUE_SCRIPT, inlineTrack } from './inline.js';
import './test-destinations.js';

/** runs the head script and an inline call the way a page does, `self` being the window */
function runInline(script: string): void {
  // eslint-disable-next-line no-new-func -- the inline scripts run as written
  new Function(RELAY_QUEUE_SCRIPT + script)();
}

afterEach(() => {
  // the inline script assigned the global itself, so the stub clears it before the restore
  vi.stubGlobal('__relay__', undefined);
  vi.unstubAllGlobals();
});

describe('inlineTrack', () => {
  test('tracks into the queue the head script creates', () => {
    vi.stubGlobal('self', globalThis);

    runInline(inlineTrack({ key: 'viewProduct', event: { a: 'view 1' } }));
    runInline(inlineTrack({ a: 'view 2' }));

    expect(globalThis.__relay__?.q).toEqual([{ key: 'viewProduct', event: { a: 'view 1' } }, { a: 'view 2' }]);
  });

  test('never closes the script tag it is written into', () => {
    const script = inlineTrack({ a: '</script><script>alert(1)</script>' });

    expect(script.toLowerCase()).not.toContain('</script');
    expect(script).toContain(String.raw`\u003c/script`);
  });
});
