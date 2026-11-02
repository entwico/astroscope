// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { openAiPixel, openai } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openAiPixel', () => {
  test('waits for the pixel and measures the payload under the event id', async () => {
    const pixel = openAiPixel();

    expect(pixel.ready?.()).toBe(false);

    const oaiq = vi.fn();

    vi.stubGlobal('oaiq', oaiq);

    expect(pixel.ready?.()).toBe(true);

    pixel.send(openai.leadCreated(), { id: 'e-1', at: 1 });

    await vi.waitFor(() => expect(oaiq).toHaveBeenCalledWith('measure', 'lead_created', { type: 'customer_action' }, { event_id: 'e-1' }));
  });

  test('a failing pixel is reported, never an unhandled rejection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal('oaiq', () => {
      throw new Error('boom');
    });

    openAiPixel().send(openai.leadCreated(), { id: 'e-1', at: 1 });

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('relay: destination openai failed', expect.any(Error)));
  });
});
