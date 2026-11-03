// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { sha256 } from '../conversion-user.js';
import { meta, metaPixel } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('metaPixel', () => {
  test('waits for the pixel and fires the event on it under the event id', async () => {
    const pixel = metaPixel({ pixelId: '123' });

    expect(pixel.ready?.()).toBe(false);

    const fbq = vi.fn();

    vi.stubGlobal('fbq', fbq);

    expect(pixel.ready?.()).toBe(true);

    pixel.send(meta.pageView(), { id: 'e-1', at: 1 });

    await vi.waitFor(() => expect(fbq).toHaveBeenCalledWith('trackSingle', '123', 'PageView', {}, { eventID: 'e-1' }));

    expect(fbq).toHaveBeenCalledTimes(1);
  });

  test('hands the first hashed identifiers of the page to the pixel before a conversion, once', async () => {
    const fbq = vi.fn();

    vi.stubGlobal('fbq', fbq);

    const pixel = metaPixel({ pixelId: '123', countryCallingCode: '49' });

    pixel.send(meta.lead({ content_name: 'contact' }, { email: 'Jane@Example.com', phone: '0171 2345678', postalCode: '80331', country: 'DE' }), { id: 'e-1', at: 1 });

    await vi.waitFor(() => expect(fbq).toHaveBeenCalledTimes(2));

    expect(fbq).toHaveBeenNthCalledWith(1, 'init', '123', {
      em: await sha256('jane@example.com'),
      ph: await sha256('491712345678'),
      zp: await sha256('80331'),
      country: await sha256('de'),
    });
    expect(fbq).toHaveBeenNthCalledWith(2, 'trackSingle', '123', 'Lead', { content_name: 'contact' }, { eventID: 'e-1' });

    // another set would be refused by the pixel with a warning: not sent
    pixel.send(meta.subscribe({}, { email: 'john@example.com' }), { id: 'e-2', at: 2 });

    await vi.waitFor(() => expect(fbq).toHaveBeenCalledTimes(3));

    pixel.send(meta.event('QuizResult', { status: 'hp' }), { id: 'e-3', at: 3 });

    await vi.waitFor(() => expect(fbq).toHaveBeenCalledTimes(4));

    expect(fbq).toHaveBeenNthCalledWith(3, 'trackSingle', '123', 'Subscribe', {}, { eventID: 'e-2' });
    expect(fbq).toHaveBeenNthCalledWith(4, 'trackSingleCustom', '123', 'QuizResult', { status: 'hp' }, { eventID: 'e-3' });
  });

  test('a failing pixel is reported, never an unhandled rejection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal('fbq', () => {
      throw new Error('boom');
    });

    metaPixel({ pixelId: '123' }).send(meta.pageView(), { id: 'e-1', at: 1 });

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('relay: destination meta failed', expect.any(Error)));
  });
});
