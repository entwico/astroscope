import { describe, expect, test, vi } from 'vitest';
import type { ServerEventMeta } from '../runtime.js';
import { openAiConversions } from './server.js';
import { openai } from './shared.js';

function createMeta(overrides: Partial<ServerEventMeta> = {}): ServerEventMeta {
  return {
    id: 'evt-1',
    at: 1000,
    key: undefined,
    request: {
      clientAddress: '203.0.113.7',
      headers: new Headers({ 'user-agent': 'test' }),
      cookie: (name: string) => (name === '__obref' ? 'ref-1' : undefined),
      sourceUrl: 'https://example.com/contact',
    },
    ...overrides,
  };
}

function createFetch() {
  const calls: { url: string; body: unknown }[] = [];
  const doFetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });

    return Promise.resolve(new Response('{}', { status: 200 }));
  });

  return { calls, fetch: doFetch as unknown as typeof fetch };
}

describe('openAiConversions', () => {
  test('reports the event under the id with the hashed identifiers and the request', async () => {
    const { calls, fetch } = createFetch();
    const conversions = openAiConversions({ apiKey: 'k', pixelId: 'p', integrationSource: 'test', countryCallingCode: '49', fetch });

    await conversions.send(openai.leadCreated({ email: 'Jane@Example.com', phone: '0171 2345678' }), createMeta());
    await conversions.send(openai.orderCreated({ items: [{ id: 'a', name: 'A', price: 10, quantity: 1 }], currency: 'EUR' }), createMeta({ id: 'o-1' }));

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://bzr.openai.com/v1/events?pid=p');
    expect(calls[0]?.body).toMatchObject({
      integration_source: 'test',
      events: [
        {
          id: 'evt-1',
          type: 'lead_created',
          source_url: 'https://example.com/contact',
          data: { type: 'customer_action' },
          user: {
            emails_sha256: [expect.stringMatching(/^[0-9a-f]{64}$/)],
            phone_numbers_sha256: [expect.stringMatching(/^[0-9a-f]{64}$/)],
            ip_address: '203.0.113.7',
            user_agent: 'test',
            obref: 'ref-1',
          },
        },
      ],
    });
    expect(calls[1]?.body).toMatchObject({ events: [{ id: 'o-1', type: 'order_created', data: { amount: 1000, currency: 'EUR' } }] });
  });

  test('a failing response is an error for track() to log', async () => {
    const conversions = openAiConversions({
      apiKey: 'k',
      pixelId: 'p',
      integrationSource: 'test',
      fetch: (() => Promise.resolve(new Response('nope', { status: 500 }))) as unknown as typeof fetch,
    });

    await expect(conversions.send(openai.leadCreated(), createMeta())).rejects.toThrow('conversions api responded 500');
  });
});
