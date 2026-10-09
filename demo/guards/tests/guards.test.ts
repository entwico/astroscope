import { type ChildProcess, spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const DEV_PORT = 14_351;
const PROD_PORT = 14_352;

let devServer: ChildProcess | null = null;
let prodServer: ChildProcess | null = null;

async function waitForServer(port: number, timeout = 30_000): Promise<void> {
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

  await Promise.all([waitForServer(DEV_PORT), waitForServer(PROD_PORT)]);
}, 60_000);

afterAll(() => {
  // astro dev daemonizes under @astroscope/node — killing the wrapper is not enough
  spawn('npx', ['astro', 'dev', 'stop'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
  devServer?.kill();
  prodServer?.kill();
});

type Who = 'alice' | 'root' | undefined;

const as = (user: Who): Record<string, string> => (user ? { 'x-demo-user': user } : {});

// the node adapter's csrf check wants a same-site origin on mutating requests
const mutating = (port: number, user: Who, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: `http://localhost:${port}`,
    ...as(user),
  },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

const rpc = (port: number, name: string, user: Who, input?: unknown) =>
  fetch(`http://localhost:${port}/_actions/${name}`, mutating(port, user, input));

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

// a browser navigation accepts html; an api caller does not — the denial follows the request
const page = (port: number, path: string, user: Who) =>
  fetch(`http://localhost:${port}${path}`, { headers: { accept: 'text/html,*/*', ...as(user) }, redirect: 'manual' });

const api = (port: number, path: string, user: Who) =>
  fetch(`http://localhost:${port}${path}`, { headers: as(user), redirect: 'manual' });

describe.each([
  ['prod', PROD_PORT],
  ['dev', DEV_PORT],
])('%s', (_label, port) => {
  describe('actions', () => {
    test('an authenticated action denies nobody and answers the user', async () => {
      const anonymous = await rpc(port, 'whoami', undefined);

      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toMatchObject({ type: 'AstroActionError', code: 'UNAUTHORIZED' });

      const alice = await rpc(port, 'whoami', 'alice');

      expect(alice.status).toBe(200);
      expect(await rpcResult(alice)).toEqual({ name: 'alice' });
    });

    test('an admin action runs the parent guard first', async () => {
      const anonymous = await rpc(port, 'promote', undefined, { name: 'bob' });
      const alice = await rpc(port, 'promote', 'alice', { name: 'bob' });

      expect(anonymous.status).toBe(401);
      expect(alice.status).toBe(403);

      const root = await rpc(port, 'promote', 'root', { name: 'bob' });

      expect(await rpcResult(root)).toEqual({ promoted: 'bob', by: 'root' });
    });

    test('a guard reading the input proves what it loaded, and the shared key stays for the handler', async () => {
      const owner = await rpc(port, 'rename', 'alice', { projectId: 'p1', name: `Alpha ${port}` });

      expect(owner.status).toBe(200);
      expect(await rpcResult(owner)).toMatchObject({ id: 'p1', name: `Alpha ${port}`, owner: 'alice' });

      const foreign = await rpc(port, 'rename', 'alice', { projectId: 'p2', name: 'x' });
      const unknown = await rpc(port, 'rename', 'alice', { projectId: 'nope', name: 'x' });
      // validation runs before the guards: a missing input is a 400, not a 401
      const invalid = await rpc(port, 'rename', undefined, { name: 'x' });

      expect(foreign.status).toBe(403);
      expect(unknown.status).toBe(404);
      expect(invalid.status).toBe(400);
    });
  });

  describe('endpoints', () => {
    test('a denial answers with the status and a json error', async () => {
      const anonymous = await api(port, '/api/admin', undefined);

      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'sign in first' } });

      const alice = await api(port, '/api/admin', 'alice');
      const root = await api(port, '/api/admin', 'root');

      expect(alice.status).toBe(403);
      expect(await root.json()).toEqual({ admin: 'root' });
    });

    test('guard input comes from the body', async () => {
      const json = await fetch(`http://localhost:${port}/api/project`, mutating(port, 'alice', { projectId: 'p1' }));

      expect(await json.json()).toMatchObject({ id: 'p1', owner: 'alice' });

      const form = await fetch(`http://localhost:${port}/api/project`, {
        method: 'POST',
        headers: { origin: `http://localhost:${port}`, ...as('root') },
        body: new URLSearchParams({ projectId: 'p1' }),
      });

      expect(form.status).toBe(403);

      const missing = await fetch(`http://localhost:${port}/api/project`, mutating(port, 'alice', {}));

      expect(missing.status).toBe(400);
    });
  });

  describe('pages', () => {
    test('the denying guard picks the response: redirect for nobody, 404 for a non-admin', async () => {
      const anonymous = await page(port, '/admin', undefined);

      expect(anonymous.status).toBe(302);
      expect(anonymous.headers.get('location')).toBe('/?next=%2Fadmin');

      const alice = await page(port, '/admin', 'alice');

      expect(alice.status).toBe(404);
      expect(await alice.text()).toContain('There is nothing here');

      const root = await page(port, '/admin', 'root');

      expect(root.status).toBe(200);
      expect(await root.text()).toContain('Welcome');
    });

    test('the denial follows the request, not the surface', async () => {
      // a page fetched from a script gets the json error, not a redirect it cannot follow
      const scripted = await api(port, '/admin', undefined);

      expect(scripted.status).toBe(401);
      expect(await scripted.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'sign in first' } });

      // an endpoint opened in a browser gets the page response
      const browsed = await page(port, '/api/admin', undefined);

      expect(browsed.status).toBe(302);
      expect(browsed.headers.get('location')).toBe('/?next=%2Fapi%2Fadmin');
    });

    test('a proven user renders', async () => {
      const anonymous = await page(port, '/me', undefined);

      expect(anonymous.status).toBe(302);

      const alice = await page(port, '/me', 'alice');

      expect(alice.status).toBe(200);
      expect(await alice.text()).toContain('alice');
    });
  });
});
