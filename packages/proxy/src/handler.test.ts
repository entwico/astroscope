import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { APIContext } from 'astro';
import { afterEach, describe, expect, test } from 'vitest';
import { createProxyHandler } from './handler';
import type { ProxyOptions } from './types';

type UpstreamHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

describe('createProxyHandler', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => {
        server.closeAllConnections();

        return new Promise((resolve) => server.close(resolve));
      }),
    );
  });

  async function startUpstream(handle: UpstreamHandler): Promise<string> {
    const server = createServer((req, res) => void handle(req, res));

    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  // an upstream that answers every request with what it received
  async function startEchoUpstream(): Promise<{ upstream: string; received: Received[] }> {
    const received: Received[] = [];

    const upstream = await startUpstream(async (req, res) => {
      let body = '';

      for await (const chunk of req) body += String(chunk);

      received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    return { upstream, received };
  }

  function proxy(options: ProxyOptions, request: Request, context: Partial<APIContext> = {}): Promise<Response> {
    const handler = createProxyHandler(options);

    // defineProperties rather than a spread: a getter in the context must stay a getter
    return handler(Object.defineProperties({ request }, Object.getOwnPropertyDescriptors(context)) as APIContext);
  }

  function within<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
    return Promise.race([promise, new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms))]);
  }

  async function readOutcome(response: Response): Promise<'completed' | 'errored'> {
    try {
      await response.text();

      return 'completed';
    } catch {
      return 'errored';
    }
  }

  test('forwards method, path, query and body, with the host set to the upstream', async () => {
    const { upstream, received } = await startEchoUpstream();

    const response = await proxy(
      { upstream },
      new Request('http://site.test/orders/1?expand=items', { method: 'POST', body: 'payload' }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/orders/1?expand=items', body: 'payload' });
    expect(received[0]?.headers.host).toBe(new URL(upstream).host);
  });

  test('passes upstream status, headers and multiple set-cookie values back', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(201, { 'x-upstream': 'yes', 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] });
      res.end('created');
    });

    const response = await proxy({ upstream }, new Request('http://site.test/items'));

    expect(response.status).toBe(201);
    expect(response.headers.get('x-upstream')).toBe('yes');
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    expect(await response.text()).toBe('created');
  });

  test('answers 502 when the upstream is unreachable', async () => {
    const response = await proxy({ upstream: 'http://127.0.0.1:1' }, new Request('http://site.test/'));

    expect(response.status).toBe(502);
  });

  test('answers 502 when the upstream does not answer within headersTimeout', async () => {
    const upstream = await startUpstream(() => {});
    const errors: Error[] = [];

    const response = await proxy(
      {
        upstream,
        client: { headersTimeout: 100 },
        onError: (_context, error) => {
          errors.push(error);
        },
      },
      new Request('http://site.test/'),
    );

    expect(response.status).toBe(502);
    expect(errors[0]?.name).toBe('HeadersTimeoutError');
  });

  test('answers 499 when the client aborts while the upstream is still working', async () => {
    const upstream = await startUpstream(() => {});
    const controller = new AbortController();
    const pending = proxy({ upstream }, new Request('http://site.test/', { signal: controller.signal }));

    setTimeout(() => controller.abort(), 50);

    const response = await pending;

    expect(response.status).toBe(499);
  });

  test('a hook that throws answers 500 and releases the upstream connection', async () => {
    const closed: boolean[] = [];
    const upstream = await startUpstream((_req, res) => {
      res.once('close', () => {
        closed.push(true);
      });
      res.writeHead(200);
      res.write('partial');
    });

    const response = await proxy(
      {
        upstream,
        onResponse: () => {
          throw new Error('hook broke');
        },
      },
      new Request('http://site.test/'),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Proxy hook failed');

    await expect.poll(() => closed.length).toBe(1);
  });

  test('answers with the response of onRequest without asking the upstream', async () => {
    const { upstream, received } = await startEchoUpstream();

    const response = await proxy(
      { upstream, onRequest: () => new Response('blocked', { status: 403 }) },
      new Request('http://site.test/admin'),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('blocked');
    expect(received).toHaveLength(0);
  });

  test('forwards the request onRequest returns, to the target url and not to its own', async () => {
    const { upstream, received } = await startEchoUpstream();

    const response = await proxy(
      {
        upstream,
        onRequest: (context) =>
          new Request('http://elsewhere.test/ignored', {
            method: 'PUT',
            headers: { ...Object.fromEntries(context.request.headers), 'x-added': 'yes' },
            body: 'replaced',
          }),
      },
      new Request('http://site.test/orders/1', { method: 'POST', headers: { 'x-original': 'kept' }, body: 'payload' }),
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'PUT', url: '/orders/1', body: 'replaced' });
    expect(received[0]?.headers).toMatchObject({ 'x-added': 'yes', 'x-original': 'kept' });
    expect(received[0]?.headers.host).toBe(new URL(upstream).host);
  });

  test('sends the request where onRequest moved the target url', async () => {
    const { upstream, received } = await startEchoUpstream();

    await proxy(
      {
        upstream,
        onRequest: (_context, targetUrl) => {
          targetUrl.pathname = `/v2${targetUrl.pathname}`;
          targetUrl.searchParams.set('via', 'proxy');
        },
      },
      new Request('http://site.test/orders?page=2', { method: 'POST', body: 'payload' }),
    );

    expect(received[0]).toMatchObject({ method: 'POST', url: '/v2/orders?page=2&via=proxy', body: 'payload' });
  });

  test('an onRequest that throws answers 500 without asking the upstream', async () => {
    const { upstream, received } = await startEchoUpstream();

    const response = await proxy(
      {
        upstream,
        onRequest: () => {
          throw new Error('hook broke');
        },
      },
      new Request('http://site.test/'),
    );

    expect(response.status).toBe(500);
    expect(received).toHaveLength(0);
  });

  test('answers with the response of onError, which gets the failure and the target url', async () => {
    const seen: { message: string; target: string }[] = [];

    const response = await proxy(
      {
        upstream: 'http://127.0.0.1:1/base',
        onError: (_context, error, targetUrl) => {
          seen.push({ message: error.message, target: targetUrl.href });

          return new Response('maintenance', { status: 503 });
        },
      },
      new Request('http://site.test/page?x=1'),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('maintenance');
    expect(seen).toEqual([{ message: expect.any(String), target: 'http://127.0.0.1:1/base/page?x=1' }]);
  });

  test('onError gets what a hook threw as an error, and its void keeps the default answer', async () => {
    const { upstream } = await startEchoUpstream();
    const errors: Error[] = [];

    const response = await proxy(
      {
        upstream,
        onRequest: () => {
          throw 'not an error';
        },
        onError: (_context, error) => {
          errors.push(error);
        },
      },
      new Request('http://site.test/'),
    );

    expect(response.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[0]?.message).toBe('not an error');
  });

  test('answers with the response onResponse returns, and with the upstream one for void', async () => {
    const { upstream } = await startEchoUpstream();

    const replaced = await proxy(
      {
        upstream,
        onResponse: async (_context, response) =>
          new Response(`${await response.text()} (rewritten)`, { status: 202, headers: { 'x-rewritten': 'yes' } }),
      },
      new Request('http://site.test/'),
    );

    expect(replaced.status).toBe(202);
    expect(replaced.headers.get('x-rewritten')).toBe('yes');
    expect(await replaced.text()).toBe('ok (rewritten)');

    const statuses: number[] = [];
    const kept = await proxy(
      {
        upstream,
        onResponse: (_context, response) => {
          statuses.push(response.status);
        },
      },
      new Request('http://site.test/'),
    );

    expect(statuses).toEqual([200]);
    expect(await kept.text()).toBe('ok');
  });

  test('an upstream status no response can carry is the upstream\'s failure, and its connection is released', async () => {
    const closed: boolean[] = [];
    const upstream = await startUpstream((_req, res) => {
      res.once('close', () => {
        closed.push(true);
      });
      res.writeHead(700);
      res.write('partial');
    });

    const response = await proxy({ upstream }, new Request('http://site.test/'));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('Upstream is down');

    await expect.poll(() => closed.length).toBe(1);
  });

  test('keeps the path of the upstream url as a prefix', async () => {
    const { upstream, received } = await startEchoUpstream();

    await proxy({ upstream: `${upstream}/v1` }, new Request('http://site.test/users?page=2'));

    expect(received[0]?.url).toBe('/v1/users?page=2');
  });

  test('rejects an upstream carrying credentials, a query or a fragment', () => {
    for (const upstream of ['http://user:pw@legacy.test', 'http://legacy.test/?v=1', 'http://legacy.test/#x']) {
      expect(() => createProxyHandler({ upstream })).toThrow('upstream must be an origin');
    }
  });

  test('forwards a request body the client sent chunked', async () => {
    const { upstream, received } = await startEchoUpstream();

    const response = await proxy(
      { upstream },
      new Request('http://site.test/upload', {
        method: 'POST',
        headers: { 'transfer-encoding': 'chunked' },
        body: 'payload',
      }),
    );

    expect(response.status).toBe(200);
    expect(received[0]?.body).toBe('payload');
  });

  test('forwards a request that announced its body with expect: 100-continue', async () => {
    const { upstream, received } = await startEchoUpstream();

    const response = await proxy(
      { upstream },
      new Request('http://site.test/upload', {
        method: 'POST',
        headers: { expect: '100-continue' },
        body: 'payload',
      }),
    );

    expect(response.status).toBe(200);
    expect(received[0]?.body).toBe('payload');
  });

  test('does not forward hop-by-hop request headers', async () => {
    const { upstream, received } = await startEchoUpstream();

    const response = await proxy(
      { upstream },
      new Request('http://site.test/', {
        headers: {
          connection: 'keep-alive, x-hop-secret',
          'x-hop-secret': 'client-proxy only',
          'proxy-authorization': 'Basic Zm9vOmJhcg==',
          te: 'trailers',
          trailer: 'x-checksum',
        },
      }),
    );

    expect(response.status).toBe(200);

    const headers = received[0]?.headers ?? {};

    expect(headers['x-hop-secret']).toBeUndefined();
    expect(headers['proxy-authorization']).toBeUndefined();
    expect(headers['te']).toBeUndefined();
    expect(headers['trailer']).toBeUndefined();
  });

  test('sets the forwarded headers from the incoming request', async () => {
    const { upstream, received } = await startEchoUpstream();

    await proxy({ upstream }, new Request('https://site.test/orders'), { clientAddress: '203.0.113.9' });

    const headers = received[0]?.headers ?? {};

    expect(headers['x-forwarded-for']).toBe('203.0.113.9');
    expect(headers['x-forwarded-host']).toBe('site.test');
    expect(headers['x-forwarded-proto']).toBe('https');
  });

  test('appends the client address to a forwarded chain and keeps host and proto set in front', async () => {
    const { upstream, received } = await startEchoUpstream();

    await proxy(
      { upstream },
      new Request('http://internal.test/orders', {
        headers: {
          'x-forwarded-for': '6.6.6.6',
          'x-forwarded-host': 'site.test',
          'x-forwarded-proto': 'https',
        },
      }),
      { clientAddress: '203.0.113.9' },
    );

    const headers = received[0]?.headers ?? {};

    expect(headers['x-forwarded-for']).toBe('6.6.6.6, 203.0.113.9');
    expect(headers['x-forwarded-host']).toBe('site.test');
    expect(headers['x-forwarded-proto']).toBe('https');
  });

  test('leaves a chain alone whose last entry is the client address already', async () => {
    const { upstream, received } = await startEchoUpstream();

    await proxy(
      { upstream },
      new Request('http://site.test/', { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } }),
      { clientAddress: '203.0.113.9' },
    );

    expect(received[0]?.headers['x-forwarded-for']).toBe('6.6.6.6, 203.0.113.9');
  });

  test('forwards without an address when astro has none for the request', async () => {
    const { upstream, received } = await startEchoUpstream();

    await proxy({ upstream }, new Request('http://site.test/'), {
      get clientAddress(): string {
        throw new Error('clientAddress is not available');
      },
    });

    expect(received[0]?.headers['x-forwarded-for']).toBeUndefined();
    expect(received[0]?.headers['x-forwarded-host']).toBe('site.test');
  });

  test('points a redirect to the upstream at the site, with the base path dropped', async () => {
    const upstream = await startUpstream((req, res) => {
      const base = `http://${req.headers.host}`;

      res.writeHead(302, {
        location: `${base}/v1/login?next=%2Faccount`,
        'content-location': `${base}/v1/account`,
        'x-foreign': 'https://other.test/login',
      });
      res.end();
    });

    const response = await proxy({ upstream: `${upstream}/v1` }, new Request('https://site.test/account'));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://site.test/login?next=%2Faccount');
    expect(response.headers.get('content-location')).toBe('https://site.test/account');
  });

  test('leaves redirects to other hosts and relative redirects alone', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(302, { location: req.url === '/relative' ? '/login' : 'https://other.test/login' });
      res.end();
    });

    const absolute = await proxy({ upstream }, new Request('https://site.test/absolute'));
    const relative = await proxy({ upstream }, new Request('https://site.test/relative'));

    expect(absolute.headers.get('location')).toBe('https://other.test/login');
    expect(relative.headers.get('location')).toBe('/login');
  });

  test('drops a cookie domain scoped to the upstream host, keeps other domains', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, {
        'set-cookie': [
          'session=abc; Domain=127.0.0.1; Path=/; HttpOnly',
          'theme=dark; Domain=.other.test; Path=/',
          'plain=1; Path=/',
        ],
      });
      res.end('ok');
    });

    const response = await proxy({ upstream }, new Request('https://site.test/'));

    expect(response.headers.getSetCookie()).toEqual([
      'session=abc; Path=/; HttpOnly',
      'theme=dark; Domain=.other.test; Path=/',
      'plain=1; Path=/',
    ]);
  });

  test('accepts a keep-alive request header instead of failing the request', async () => {
    const { upstream } = await startEchoUpstream();

    const response = await proxy(
      { upstream },
      new Request('http://site.test/', { headers: { connection: 'keep-alive', 'keep-alive': 'timeout=5' } }),
    );

    expect(response.status).toBe(200);
  });

  test('does not pass hop-by-hop response headers to the client', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { connection: 'keep-alive, x-hop-secret', 'x-hop-secret': 'proxy only' });
      res.write('chunked ');
      res.end('body');
    });

    const response = await proxy({ upstream }, new Request('http://site.test/'));

    expect(await response.text()).toBe('chunked body');
    expect(response.headers.get('connection')).toBeNull();
    expect(response.headers.get('keep-alive')).toBeNull();
    expect(response.headers.get('transfer-encoding')).toBeNull();
    expect(response.headers.get('x-hop-secret')).toBeNull();
  });

  test('passes a 205 reset content answer through', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(205);
      res.end();
    });

    const response = await proxy({ upstream }, new Request('http://site.test/form', { method: 'POST', body: 'x' }));

    expect(response.status).toBe(205);
  });

  test('errors the response body when the upstream connection breaks mid-body', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-length': '1000' });
      res.write('partial', () => setTimeout(() => res.socket?.destroy(), 20));
    });

    const response = await proxy({ upstream }, new Request('http://site.test/'));
    const outcome = await within(readOutcome(response), 2000);

    expect(outcome).toBe('errored');
  });

  test('stops reading from the upstream while the client does not consume the body', async () => {
    const total = 64 * 1024 * 1024;
    const chunk = Buffer.alloc(64 * 1024, 'x');
    let written = 0;

    const upstream = await startUpstream(async (_req, res) => {
      res.writeHead(200, { 'content-length': String(total) });

      while (written < total) {
        written += chunk.length;

        if (!res.write(chunk)) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
      }

      res.end();
    });

    const response = await proxy({ upstream }, new Request('http://site.test/large'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(written).toBeLessThan(total / 4);

    await response.body?.cancel();
  });
});
