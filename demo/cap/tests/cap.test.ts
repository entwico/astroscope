import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startCapStub } from '../stub/cap-service.mjs';

const DEV_PORT = 14361;
const PROD_PORT = 14362;
const STUB_PORT = 14363;

let devServer: ChildProcess | null = null;
let prodServer: ChildProcess | null = null;
let stub: ReturnType<typeof startCapStub> | null = null;

async function waitForServer(port: number, timeout = 30000): Promise<void> {
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

  throw new Error(`Server on port ${port} did not start within ${timeout}ms`);
}

beforeAll(async () => {
  stub = startCapStub({ port: STUB_PORT });

  await stub.listening;

  // astro skips mounting its dev handlers when VITEST is set — the child must not inherit it
  const { VITEST: _vitest, ...env } = process.env;
  const capEnv = { CAP_BASE_URL: `http://localhost:${STUB_PORT}` };

  devServer = spawn('npx', ['astro', 'dev', '--port', String(DEV_PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
    env: { ...env, ...capEnv },
  });

  // prod server assumes the build already ran (turbo test depends on build);
  // health and metrics get their own ports so parallel demo suites don't collide
  prodServer = spawn('node', ['./dist/server/entry.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      ...capEnv,
      PORT: String(PROD_PORT),
      HEALTH_PORT: String(PROD_PORT + 1),
      OTEL_EXPORTER_PROMETHEUS_PORT: String(PROD_PORT + 2),
    },
    stdio: 'pipe',
  });

  await Promise.all([waitForServer(DEV_PORT), waitForServer(PROD_PORT)]);
}, 60000);

afterAll(async () => {
  // astro dev daemonizes under @astroscope/node — killing the wrapper is not enough
  spawn('npx', ['astro', 'dev', 'stop'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
  devServer?.kill();
  prodServer?.kill();
  await stub?.close();
});

// the node adapter's csrf check wants a same-site origin on mutating requests
const post = (port: number, path: string, body: unknown) =>
  fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` },
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

// what the browser does through the proxy: fetch a challenge, redeem a solution — the stub takes any
async function solve(port: number): Promise<string> {
  const challenge = (await (await post(port, '/_cap/challenge', {})).json()) as { token: string };
  const redeemed = (await (await post(port, '/_cap/redeem', { token: challenge.token, solutions: [1, 2] })).json()) as {
    success: boolean;
    token: string;
  };

  expect(redeemed.success).toBe(true);

  return redeemed.token;
}

describe.each([
  ['prod', PROD_PORT],
  ['dev', DEV_PORT],
])('%s', (_label, port) => {
  describe('proxy', () => {
    test('forwards challenge and redeem under the site key, with the client address', async () => {
      const before = stub!.calls.length;
      const token = await solve(port);

      expect(token).toMatch(/^cap-/);

      const forwarded = stub!.calls.slice(before);

      expect(forwarded.map((call) => call.endpoint)).toEqual(['challenge', 'redeem']);
      expect(forwarded[0]?.headers['x-forwarded-for']).toBeTruthy();
    });

    test('exposes nothing else of the service', async () => {
      expect((await post(port, '/_cap/siteverify', { secret: 'demo-secret', response: 'x' })).status).toBe(404);
      expect((await fetch(`http://localhost:${port}/_cap/challenge`)).status).toBe(404);
    });
  });

  describe('captcha guard', () => {
    test('an action runs with a solved token, once', async () => {
      const _cap = await solve(port);
      const first = await post(port, '/_actions/subscribe', { email: 'a@example.com', _cap });

      expect(first.status).toBe(200);
      expect(await rpcResult(first)).toMatchObject({ subscribed: 'a@example.com' });

      const again = await post(port, '/_actions/subscribe', { email: 'a@example.com', _cap });

      expect(again.status).toBe(403);
      expect(await again.json()).toMatchObject({ type: 'AstroActionError', code: 'FORBIDDEN' });
    });

    test('a missing token is an input error, a bad token a rejection', async () => {
      expect((await post(port, '/_actions/subscribe', { email: 'a@example.com' })).status).toBe(400);
      expect((await post(port, '/_actions/subscribe', { email: 'a@example.com', _cap: 'nope' })).status).toBe(403);
    });

    test('a rate limiter in front refuses a flood before siteverify is asked', async () => {
      const before = stub!.calls.filter((call) => call.endpoint === 'siteverify').length;
      const statuses: number[] = [];

      for (let i = 0; i < 4; i++) {
        statuses.push((await post(port, '/_actions/contact', { name: 'x', message: 'y', _cap: 'invented' })).status);
      }

      expect(statuses).toEqual([403, 403, 403, 429]);
      expect(stub!.calls.filter((call) => call.endpoint === 'siteverify').length - before).toBe(3);
    });

    test('an endpoint reads the token from the body', async () => {
      const _cap = await solve(port);

      expect(await (await post(port, '/api/inquiry', { _cap })).json()).toEqual({ received: true });

      const form = await fetch(`http://localhost:${port}/api/inquiry`, {
        method: 'POST',
        headers: { origin: `http://localhost:${port}` },
        body: new URLSearchParams({ _cap: await solve(port) }),
      });

      expect(form.status).toBe(200);
      expect((await post(port, '/api/inquiry', { _cap: 'nope' })).status).toBe(403);
    });

    test('a page guards its own post', async () => {
      const verified = await fetch(`http://localhost:${port}/plain`, {
        method: 'POST',
        headers: { origin: `http://localhost:${port}` },
        body: new URLSearchParams({ name: 'x', _cap: await solve(port) }),
      });

      expect(verified.status).toBe(200);
      expect(await verified.text()).toContain('Verified');

      const unsolved = await fetch(`http://localhost:${port}/plain`, {
        method: 'POST',
        headers: { origin: `http://localhost:${port}` },
        body: new URLSearchParams({ name: 'x' }),
      });

      expect(unsolved.status).toBe(400);
    });
  });
});

// no browser runner here, so the proof is static against the built client plus the prod server:
// every absolute url in the client chunks is accounted for, every cdn default the cap client
// ships is overridden by a global the bundle sets, and the overriding assets are served from the
// origin. a cap-widget upgrade that adds a cdn fetch, a vendor host or a new referral fails here
describe('third-party requests', () => {
  const assetsDir = new URL('../dist/client/_astro/', import.meta.url);
  const chunks = readdirSync(assetsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, source: readFileSync(new URL(name, assetsDir), 'utf8') }));
  const bundle = chunks.map((chunk) => chunk.source).join('\n');

  // hosts a client chunk may name without making a request: xml namespaces, react's error
  // message urls, pako's banner comment, and cap's own, which the tests below pin down
  const ALLOWED_HOSTS = new Set(['www.w3.org', 'react.dev', 'github.com', 'cdn.jsdelivr.net', 'trycap.dev']);

  const urls = [...bundle.matchAll(/https?:\/\/[^"'` )]+/g)];
  const assigned = new Set([...bundle.matchAll(/window\.(CAP_[A-Z_]+)=/g)].map((match) => match[1]));

  test('the client chunks name no unexpected host', () => {
    const hosts = new Set(urls.map((match) => new URL(match[0]).host));

    expect([...hosts].filter((host) => !ALLOWED_HOSTS.has(host))).toEqual([]);
  });

  test('every cdn default the cap client ships is overridden by a global the bundle sets', () => {
    const cdn = urls.filter((match) => match[0].includes('cdn.jsdelivr.net'));

    expect(cdn.length).toBeGreaterThan(0);

    for (const match of cdn) {
      const guard = /window\.(CAP_[A-Z_]+)\|\|[`"']?$/.exec(bundle.slice(Math.max(0, match.index - 80), match.index));

      expect(guard, `unguarded cdn url ${match[0]}`).not.toBeNull();
      expect(assigned.has(guard![1]!), `${guard![1]} is not set by the bundle`).toBe(true);
    }
  });

  test('the vendor credits link reports nothing: the referral flag is set', () => {
    expect(bundle).toContain('CAP_DISABLE_WIDGET_REF');
    expect(bundle).toContain('window.CAP_DISABLE_WIDGET_REF=!0');
  });

  test('the overriding assets are emitted and served from the origin', async () => {
    const emitted = [...bundle.matchAll(/\/_astro\/[\w.-]+\.(?:wasm|js)/g)].map((match) => match[0]);

    for (const asset of ['cap_wasm_bg', 'hashwx', 'pako_inflate']) {
      const url = emitted.find((candidate) => candidate.includes(asset));

      expect(url, `${asset} is not referenced by the bundle`).toBeDefined();

      const res = await fetch(`http://localhost:${PROD_PORT}${url}`);

      expect(res.status, url).toBe(200);
    }
  });
});
