import type { APIContext } from 'astro';
import { describe, expect, test, vi } from 'vitest';
import { relayConsent } from './context.js';
import { createRelayMiddleware } from './middleware.js';

describe('relay middleware', () => {
  test('never reads the headers of a prerendered request', async () => {
    const headers = vi.fn(() => new Headers());
    const request = new Request('https://example.com/about');

    Object.defineProperty(request, 'headers', { get: headers });

    const context = { request, url: new URL(request.url), isPrerendered: true } as unknown as APIContext;
    let consent: unknown;

    await createRelayMiddleware()(context, () => {
      consent = relayConsent();

      return Promise.resolve(new Response('ok'));
    });

    expect(headers).not.toHaveBeenCalled();
    expect(consent).toEqual({});
  });
});
