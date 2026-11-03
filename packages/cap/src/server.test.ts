import { guard } from '@astroscope/node/guards';
import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cap } from './runtime';
import { captcha } from './server';

vi.mock('@astroscope/node/log', () => ({
  log: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('astro:actions', () => {
  const statuses: Record<string, number> = { BAD_REQUEST: 400, FORBIDDEN: 403, SERVICE_UNAVAILABLE: 503 };

  class ActionError extends Error {
    static codeToStatus(code: string) {
      return statuses[code] ?? 500;
    }

    code: string;

    constructor({ code, message }: { code: string; message?: string }) {
      super(message ?? code);
      this.code = code;
    }
  }

  return { ActionError };
});

function createContext(body?: Record<string, string>) {
  return {
    request: new Request('https://example.com/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
    locals: {},
  } as unknown as APIContext;
}

function mockFetch(response: Response) {
  const fetchMock = vi.fn(() => Promise.resolve(response));

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

beforeEach(() => {
  cap.configure({ baseUrl: 'http://cap.test:3000', siteKey: 'site', secretKey: 'secret' });
});

afterEach(() => {
  cap.reset();
  vi.unstubAllGlobals();
});

describe('captcha guard', () => {
  test('verifies the token from the request with the cap service', async () => {
    const fetchMock = mockFetch(Response.json({ success: true }));

    const { denied } = await guard(createContext({ _cap: 'site:id:tok' }), [captcha()]);

    expect(denied).toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('http://cap.test:3000/site/siteverify');
    expect(JSON.parse(init.body as string)).toEqual({ secret: 'secret', response: 'site:id:tok' });
    expect(init.redirect).toBe('error');
  });

  test('denies a missing token without asking the service', async () => {
    const fetchMock = mockFetch(Response.json({ success: true }));

    const { denied } = await guard(createContext(), [captcha()]);

    expect(denied?.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ['success: false', Response.json({ success: false }), 403],
    ['a 4xx answer', Response.json({ success: false, error: 'Missing required parameters' }, { status: 400 }), 403],
    ['a 5xx answer', new Response('boom', { status: 500 }), 503],
  ])('maps %s to status %i', async (_label, answer, status) => {
    mockFetch(answer);

    const { denied } = await guard(createContext({ _cap: 'site:id:tok' }), [captcha()]);

    expect(denied?.status).toBe(status);
  });

  test('verifies a token once per request across captcha guard instances', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ success: fetchMock.mock.calls.length === 1 })));

    vi.stubGlobal('fetch', fetchMock);

    const guardTwice = async (ctx: APIContext) => [await guard(ctx, [captcha()]), await guard(ctx, [captcha()])];
    const [first, second] = await guardTwice(createContext({ _cap: 'site:id:tok' }));

    expect(first?.denied).toBeUndefined();
    expect(second?.denied).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('denies a token issued under another site key without asking the service', async () => {
    const fetchMock = mockFetch(Response.json({ success: true }));
    const { denied } = await guard(createContext({ _cap: 'other:id:proof' }), [captcha()]);

    expect(denied?.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a token cap does not know is rejected', async () => {
    mockFetch(Response.json({ success: false, error: 'Token not found' }, { status: 404 }));

    const { denied } = await guard(createContext({ _cap: 'site:id:proof' }), [captcha()]);

    expect(denied?.status).toBe(403);
  });

  test('cap refusing the site key or secret is unavailable, not a rejection', async () => {
    mockFetch(Response.json({ success: false, error: 'Invalid site key or secret' }, { status: 403 }));

    const { denied } = await guard(createContext({ _cap: 'site:id:proof' }), [captcha()]);

    expect(denied?.status).toBe(503);
  });

  test('denies as unavailable while not configured', async () => {
    cap.reset();

    const fetchMock = mockFetch(Response.json({ success: true }));
    const { denied } = await guard(createContext({ _cap: 'site:id:tok' }), [captcha()]);

    expect(denied?.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
