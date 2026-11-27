import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CapConfig } from './types';
import { verifyCapToken } from './verify';

vi.mock('@astroscope/node/log', () => ({
  log: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const config = { baseUrl: 'http://cap.test:3000', siteKey: 'site', secretKey: 'secret' } as CapConfig;

function mockFetch(answer: () => Promise<Response>) {
  const fetchMock = vi.fn(answer);

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyCapToken', () => {
  test.each([
    ['the service cannot be reached', new TypeError('fetch failed')],
    ['the service does not answer in time', new DOMException('timed out', 'TimeoutError')],
    ['the service answers with a redirect', new TypeError('unexpected redirect')],
  ])('is unavailable when %s', async (_label, error) => {
    mockFetch(() => Promise.reject(error));

    expect(await verifyCapToken(config, 'site:id:tok')).toBe('unavailable');
  });

  test('rejects on a successful answer that is not json', async () => {
    mockFetch(() => Promise.resolve(new Response('<html>ok</html>', { status: 200 })));

    expect(await verifyCapToken(config, 'site:id:tok')).toBe('rejected');
  });

  test('rejects on a 4xx answer that is not json', async () => {
    mockFetch(() => Promise.resolve(new Response('Not found', { status: 404 })));

    expect(await verifyCapToken(config, 'site:id:tok')).toBe('rejected');
  });

  test('rejects a truthy success that is not the boolean', async () => {
    mockFetch(() => Promise.resolve(Response.json({ success: 'true' })));

    expect(await verifyCapToken(config, 'site:id:tok')).toBe('rejected');
  });

  test('rejects a token that only starts like the site key', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(Response.json({ success: true })));

    expect(await verifyCapToken(config, 'site2:id:tok')).toBe('rejected');
    expect(await verifyCapToken(config, 'site')).toBe('rejected');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
