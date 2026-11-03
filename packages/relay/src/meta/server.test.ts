import { describe, expect, test, vi } from 'vitest';
import { sha256 } from '../conversion-user.js';
import type { ServerEventMeta } from '../runtime.js';
import { metaConversions } from './server.js';
import { meta } from './shared.js';

function createMeta(overrides: Partial<ServerEventMeta> = {}, cookies: Record<string, string> = {}): ServerEventMeta {
  return {
    id: 'evt-1',
    at: 1_700_000_000_500,
    key: undefined,
    request: {
      clientAddress: '203.0.113.7',
      headers: new Headers({ 'user-agent': 'test' }),
      cookie: (name: string) => cookies[name],
      sourceUrl: 'https://example.com/contact',
    },
    ...overrides,
  };
}

type SentBody = {
  test_event_code?: string;
  data: { user_data: Record<string, unknown> }[];
};

function createFetch() {
  const calls: { url: string; body: SentBody }[] = [];
  const doFetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as SentBody });

    return Promise.resolve(new Response('{"events_received":1,"fbtrace_id":"AbC"}', { status: 200 }));
  });

  return { calls, fetch: doFetch as unknown as typeof fetch };
}

describe('metaConversions', () => {
  test('reports the event under the id with the hashed identifiers, the request and the pixel cookies', async () => {
    const { calls, fetch } = createFetch();
    const conversions = metaConversions({ accessToken: 't', pixelId: '123', countryCallingCode: '49', fetch });

    const receipt = await conversions.send(
      meta.lead({ content_name: 'contact' }, { email: 'Jane@Example.com', phone: '0171 2345678', city: 'München', country: 'de' }),
      createMeta({}, { _fbp: 'fb.1.1.browser', _fbc: 'fb.1.1.click' }),
    );

    expect(receipt).toEqual({ eventsReceived: 1, traceId: 'AbC' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v24.0/123/events');
    expect(calls[0]?.body).toEqual({
      access_token: 't',
      data: [
        {
          event_name: 'Lead',
          event_time: 1_700_000_000,
          event_id: 'evt-1',
          event_source_url: 'https://example.com/contact',
          action_source: 'website',
          user_data: {
            em: [await sha256('jane@example.com')],
            ph: [await sha256('491712345678')],
            ct: [await sha256('münchen')],
            country: [await sha256('de')],
            client_ip_address: '203.0.113.7',
            client_user_agent: 'test',
            fbp: 'fb.1.1.browser',
            fbc: 'fb.1.1.click',
          },
          custom_data: { content_name: 'contact' },
        },
      ],
    });
  });

  test('takes the click id from the page url when the pixel has not stored it, sends the page without its query and the test event code', async () => {
    const { calls, fetch } = createFetch();
    const conversions = metaConversions({ accessToken: 't', pixelId: '123', testEventCode: 'TEST1', apiVersion: 'v23.0', fetch });

    await conversions.send(
      meta.purchase({ value: 10, currency: 'EUR', order_id: 'o-1' }),
      createMeta({ id: 'o-1', request: { ...createMeta().request, sourceUrl: 'https://example.com/?fbclid=abc' } }),
    );

    expect(calls[0]?.url).toBe('https://graph.facebook.com/v23.0/123/events');
    expect(calls[0]?.body).toMatchObject({
      test_event_code: 'TEST1',
      data: [
        {
          event_name: 'Purchase',
          event_id: 'o-1',
          event_source_url: 'https://example.com/',
          user_data: { fbc: 'fb.1.1700000000500.abc' },
          custom_data: { value: 10, currency: 'EUR', order_id: 'o-1' },
        },
      ],
    });
    expect(calls[0]?.body.data[0]?.user_data).not.toHaveProperty('fbp');
  });

  test('a failing response is an error for track() to log', async () => {
    const conversions = metaConversions({
      accessToken: 't',
      pixelId: '123',
      fetch: (() => Promise.resolve(new Response('nope', { status: 400 }))) as unknown as typeof fetch,
    });

    await expect(conversions.send(meta.lead(), createMeta())).rejects.toThrow('conversions api responded 400');
  });
});
