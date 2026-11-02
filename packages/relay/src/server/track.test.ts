import type { APIContext } from 'astro';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { RelayServerConfig, ServerDestination, ServerEventMeta } from '../runtime.js';
import { defineEvent } from '../shared.js';
import { relayConsent } from './context.js';
import { createRelayMiddleware } from './middleware.js';
import { track } from './track.js';
import '../test-destinations.js';

vi.mock('@astroscope/node/log', () => ({
  log: { error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// the registry the integration would resolve: set per test
let config: RelayServerConfig = { destinations: {} };

vi.mock('./config.js', () => ({ getServerConfig: () => config }));

const configure = (next: RelayServerConfig): void => {
  config = next;
};

function createContext(init: RequestInit = {}): APIContext {
  const request = new Request('https://example.com/_actions/subscribe', { method: 'POST', ...init });

  return {
    request,
    url: new URL(request.url),
    locals: {},
    clientAddress: '203.0.113.7',
    cookies: { get: (name: string) => (name === '__obref' ? { value: 'ref-1' } : undefined) },
  } as unknown as APIContext;
}

type TestName = 'a' | 'b' | 'c' | 'free';

function createDestination<N extends TestName>(name: N, options: Partial<ServerDestination<N>> = {}) {
  const sent: { payload: string; meta: ServerEventMeta }[] = [];
  const destination: ServerDestination<N> = {
    name,
    send: (payload, meta) => void sent.push({ payload, meta }),
    ...options,
  };

  return { destination, sent, payloads: () => sent.map(({ payload }) => payload) };
}

/** what a request with the header does: the middleware runs the handler inside the context */
async function inRequest<T>(fn: () => T, init: RequestInit = {}): Promise<T> {
  const middleware = createRelayMiddleware();
  let result: T | undefined;

  await middleware(createContext(init), () => {
    result = fn();

    return Promise.resolve(new Response('ok'));
  });

  return result as T;
}

const withConsent = (names: string, headers: Record<string, string> = {}): RequestInit => ({
  headers: { 'x-relay-consent': names, ...headers },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  config = { destinations: {} };
});

describe('track on the server', () => {
  test('sends each consented destination its payload with the request', async () => {
    const a = createDestination('a');
    const b = createDestination('b');
    const c = createDestination('c');

    configure({ destinations: { a: a.destination, b: b.destination, c: c.destination } });

    const id = await inRequest(
      () => track({ a: 'for a', b: 'for b' }),
      withConsent('a,b,c', { referer: 'https://example.com/newsletter', 'user-agent': 'ua' }),
    );

    await flush();

    expect(id).toEqual(expect.any(String));
    expect(a.payloads()).toEqual(['for a']);
    expect(b.payloads()).toEqual(['for b']);
    expect(c.payloads()).toEqual([]);
    expect(a.sent[0]?.meta).toMatchObject({ id, key: undefined, request: { clientAddress: '203.0.113.7', sourceUrl: 'https://example.com/newsletter' } });
    expect(a.sent[0]?.meta.request.cookie('__obref')).toBe('ref-1');
    expect(a.sent[0]?.meta.request.headers.get('user-agent')).toBe('ua');
  });

  test('an event fires under its own id, else a fresh one, and carries its key', async () => {
    const a = createDestination('a');
    const newsletter = defineEvent('newsletter', () => ({ a: 'sign_up' }));
    const purchase = defineEvent('purchase', (order: string) => ({ id: order, a: 'purchase' }));

    configure({ destinations: { a: a.destination } });

    const ids = await inRequest(() => [track(purchase('order-9')), track(newsletter())], withConsent('a'));

    await flush();

    expect(ids).toEqual(['order-9', expect.any(String)]);
    expect(a.sent.map(({ meta }) => [meta.id, meta.key])).toEqual([
      ['order-9', 'purchase'],
      [ids[1], 'newsletter'],
    ]);
  });

  test('a consent-free destination takes every request, a custom consent reads the record, the default needs its own name', async () => {
    const free = createDestination('free');
    const shared = createDestination('c');
    const byName = createDestination('b');

    configure({
      destinations: { free: free.destination, c: shared.destination, b: byName.destination },
      consent: { free: false, c: (record) => record['a'] === true },
    });

    await inRequest(() => track({ free: 'x', c: 'x', b: 'x' }), withConsent('a'));
    await inRequest(() => track({ free: 'x', c: 'x', b: 'x' }));
    await flush();

    expect(free.payloads()).toEqual(['x', 'x']);
    expect(shared.payloads()).toEqual(['x']);
    expect(byName.payloads()).toEqual([]);
  });

  test('outside a request, without a consented destination, or excluded nothing is reported and the id is still returned', async () => {
    const { log } = await import('@astroscope/node/log');
    const a = createDestination('a');

    expect(track({ a: 'x' })).toEqual(expect.any(String));
    expect(log.debug).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }), 'tracked outside a request, nothing reported');

    expect(await inRequest(() => track({ a: 'x' }), withConsent('a'))).toEqual(expect.any(String));
    expect(log.debug).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }), 'no consented server destination, nothing reported');

    configure({ destinations: { a: a.destination }, exclude: (ctx) => ctx.request.headers.get('x-e2e') === '1' });

    expect(await inRequest(() => track({ a: 'x' }), withConsent('a', { 'x-e2e': '1' }))).toEqual(expect.any(String));
    await flush();

    expect(a.sent).toEqual([]);

    configure({ destinations: { a: a.destination }, exclude: [{ prefix: '/_actions/' }] });

    expect(await inRequest(() => track({ a: 'x' }), withConsent('a'))).toEqual(expect.any(String));
    await flush();

    expect(a.sent).toEqual([]);
  });

  test('a failing destination is logged and does not affect the others', async () => {
    const { log } = await import('@astroscope/node/log');
    const a = createDestination('a');
    const failing = createDestination('b', { send: () => Promise.reject(new Error('down')) });
    const both = defineEvent('both', (id: string) => ({ id, a: 'x', b: 'x' }));

    configure({ destinations: { b: failing.destination, a: a.destination } });

    await inRequest(() => track(both('evt-1')), withConsent('a,b'));
    await flush();

    expect(a.payloads()).toEqual(['x']);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ destination: 'b', id: 'evt-1' }), 'failed to report conversion');
  });

  test('the consent of the request is readable where the server destinations are written', async () => {
    expect(relayConsent()).toEqual({});
    expect(await inRequest(() => relayConsent(), withConsent('a, b'))).toEqual({ a: true, b: true });
  });
});
