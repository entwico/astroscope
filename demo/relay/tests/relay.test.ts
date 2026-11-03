import { type ChildProcess, spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const DEV_PORT = 14_381;
const PROD_PORT = 14_382;

let devServer: ChildProcess | null = null;
let prodServer: ChildProcess | null = null;

// the child's output is drained from the start (an unread pipe stalls the child once it fills) and
// only surfaces when the server never comes up — a startup crash is invisible otherwise
async function waitForServer(server: ChildProcess, port: number, timeout = 30_000): Promise<void> {
  const output: string[] = [];

  const collect = (chunk: Buffer) => {
    output.push(chunk.toString());
  };

  server.stdout?.on('data', collect);
  server.stderr?.on('data', collect);

  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://localhost:${port}/`);

      if (res.ok) return;
    } catch {
      // server not ready yet
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  const exit = server.exitCode === null ? '' : ` (exited with code ${server.exitCode})`;

  throw new Error(`Server on port ${port} did not start within ${timeout}ms${exit}\n${output.join('')}`);
}

beforeAll(async () => {
  // astro skips mounting its dev handlers when VITEST is set — the child must not inherit it
  const { VITEST: _vitest, ...env } = process.env;

  devServer = spawn('npx', ['astro', 'dev', '--port', String(DEV_PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
    env,
  });

  // prod server assumes the build already ran (turbo test depends on build);
  // health and metrics get their own ports so parallel demo suites don't collide
  prodServer = spawn('node', ['./dist/server/entry.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PROD_PORT),
      HEALTH_PORT: String(PROD_PORT + 1),
      OTEL_EXPORTER_PROMETHEUS_PORT: String(PROD_PORT + 2),
    },
    stdio: 'pipe',
  });

  await Promise.all([waitForServer(devServer, DEV_PORT), waitForServer(prodServer, PROD_PORT)]);
}, 60_000);

afterAll(() => {
  // astro dev daemonizes under @astroscope/node — killing the wrapper is not enough
  spawn('npx', ['astro', 'dev', 'stop'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
  devServer?.kill();
  prodServer?.kill();
});

type ConsentRecord = Record<string, boolean>;

type CrmRecord = {
  id: string;
  event: string;
  key: string | undefined;
  email: string | undefined;
  clientAddress: string;
};

// the node adapter's csrf check wants a same-site origin on mutating requests
const post = (port: number, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://localhost:${port}`, ...headers },
    body: JSON.stringify(body),
  });

// rpc results come devalue-flattened: index 0 is the root, objects and arrays hold indices
async function rpcResult(res: Response): Promise<unknown> {
  const flat = (await res.json()) as unknown[];

  const hydrate = (index: number): unknown => {
    const value = flat[index];

    if (Array.isArray(value)) return value.map((item) => hydrate(item as number));

    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrate(item as number)]));
    }

    return value;
  };

  return hydrate(0);
}

async function crmRecords(port: number): Promise<CrmRecord[]> {
  const res = await fetch(`http://localhost:${port}/api/crm`);

  return (await res.json()) as CrmRecord[];
}

// the senders run after the response; give them a moment
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe.each([
  ['prod', PROD_PORT],
  ['dev', DEV_PORT],
])('%s', (_label, port) => {
  describe('page', () => {
    test('loads the client module and carries the inline event', async () => {
      const res = await fetch(`http://localhost:${port}/`);
      const html = await res.text();

      expect(html).toContain('self.__relay__??={q:[],track(e){this.q.push(e)}};');
      expect(html).toMatch(/<script>__relay__\.track\(\{"key":"viewProduct","event":\{.*"name":"view_item".*\);<\/script>/);
      expect(html).toMatch(/onclick="__relay__\.track\(\{&quot;key&quot;:&quot;selectOffer&quot;/);
      expect(html).toMatch(/<script type="module"[^>]*src="[^"]*"|relay\.client/);
    });
  });

  describe('track on the server', () => {
    test('reports a consented conversion and answers with the id the browser fires under', async () => {
      const res = await post(port, '/_actions/subscribe', { email: 'jane@example.com' }, { 'x-relay-consent': 'crm' });

      expect(res.status).toBe(200);

      const result = (await rpcResult(res)) as { subscribed: string; eventId: string; consent: ConsentRecord };

      expect(result).toEqual({ subscribed: 'jane@example.com', eventId: expect.any(String), consent: { crm: true } });

      await settle();

      const records = await crmRecords(port);
      const record = records.find((entry) => entry.id === result.eventId);

      expect(record).toMatchObject({ event: 'sign_up', key: 'newsletter', clientAddress: expect.any(String) });
      expect(record?.email).toMatch(/^[0-9a-f]{64}$/);
    });

    test('a declined, missing or malformed consent reports nothing, the request still passes', async () => {
      const records = await crmRecords(port);
      const before = records.length;
      const declined = await post(port, '/_actions/subscribe', { email: 'jane@example.com' }, { 'x-relay-consent': 'ga4' });
      const missing = await post(port, '/_actions/subscribe', { email: 'jane@example.com' });
      const malformed = await post(port, '/_actions/subscribe', { email: 'jane@example.com' }, {
        'x-relay-consent': '{"crm":true}',
      });

      expect(declined.status).toBe(200);
      expect(missing.status).toBe(200);
      expect(malformed.status).toBe(200);
      expect(await rpcResult(missing)).toMatchObject({ eventId: expect.any(String), consent: {} });
      expect(await rpcResult(malformed)).toMatchObject({ consent: {} });

      await settle();

      const after = await crmRecords(port);

      expect(after.length).toBe(before);
    });

    test('an excluded request reports nothing', async () => {
      const res = await post(port, '/_actions/subscribe', { email: 'jane@example.com' }, { 'x-relay-consent': 'crm', 'x-e2e': '1' });

      expect(res.status).toBe(200);

      const { eventId } = (await rpcResult(res)) as { eventId: string };

      await settle();

      const records = await crmRecords(port);

      expect(records.some((entry) => entry.id === eventId)).toBe(false);
    });
  });
});
