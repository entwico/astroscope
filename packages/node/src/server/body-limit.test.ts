import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { enforceBodyLimit } from './body-limit';

describe('enforceBodyLimit', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function startServer(limit: number): Promise<string> {
    const server = createServer(async (req, res) => {
      if (enforceBodyLimit(req, res, limit)) return;

      let received = 0;

      for await (const chunk of req) received += (chunk as Buffer).length;

      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`received ${received}`);
    });

    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  test('refuses an announced body over the limit with 413, before reading it', async () => {
    const baseUrl = await startServer(1024);

    const refused = await fetch(baseUrl, { method: 'POST', body: 'x'.repeat(2048) });

    expect(refused.status).toBe(413);
    expect(refused.headers.get('connection')).toBe('close');
    expect(await refused.text()).toBe('Request body too large');
  });

  test('lets bodies at or under the limit, and requests without one, through', async () => {
    const baseUrl = await startServer(1024);

    expect(await (await fetch(baseUrl, { method: 'POST', body: 'x'.repeat(1024) })).text()).toBe('received 1024');
    expect(await (await fetch(baseUrl)).text()).toBe('received 0');
  });

  test('0 and Infinity disable the limit', async () => {
    for (const limit of [0, Number.POSITIVE_INFINITY]) {
      const baseUrl = await startServer(limit);

      expect((await fetch(baseUrl, { method: 'POST', body: 'x'.repeat(4096) })).status).toBe(200);
    }
  });
});
