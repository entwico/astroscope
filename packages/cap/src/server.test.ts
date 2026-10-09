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
    code: string;

    constructor({ code, message }: { code: string; message?: string }) {
      super(message ?? code);
      this.code = code;
    }

    static codeToStatus(code: string) {
      return statuses[code] ?? 500;
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
  const fetchMock = vi.fn(async () => response);

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

    const { denied } = await guard(createContext({ _cap: 'tok' }), [captcha()]);

    expect(denied).toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('http://cap.test:3000/site/siteverify');
    expect(JSON.parse(init.body as string)).toEqual({ secret: 'secret', response: 'tok' });
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

    const { denied } = await guard(createContext({ _cap: 'tok' }), [captcha()]);

    expect(denied?.status).toBe(status);
  });

  test('denies as unavailable while not configured', async () => {
    cap.reset();

    const fetchMock = mockFetch(Response.json({ success: true }));
    const { denied } = await guard(createContext({ _cap: 'tok' }), [captcha()]);

    expect(denied?.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
