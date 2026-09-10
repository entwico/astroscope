import { type ChildProcess, spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const DEV_PORT = 14341;
const PROD_PORT = 14342;

let devServer: ChildProcess | null = null;
let prodServer: ChildProcess | null = null;

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
}, 60000);

afterAll(() => {
  // astro dev daemonizes under @astroscope/node — killing the wrapper is not enough
  spawn('npx', ['astro', 'dev', 'stop'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
  devServer?.kill();
  prodServer?.kill();
});

const page = (port: number, path = '/') => fetch(`http://localhost:${port}${path}`).then((r) => r.text());
const loads = (port: number) =>
  fetch(`http://localhost:${port}/api/loads`).then((r) => r.json() as Promise<Record<string, number>>);

describe('server-side reads', () => {
  test('frontmatter renders wormhole values', async () => {
    const html = await page(PROD_PORT);

    expect(html).toContain('Astroscope Demo');
    expect(html).toContain('Initial counter:');
  });
});

describe('prod delivery (sliced)', () => {
  test('island wormholes are merged before the first island tag', async () => {
    const html = await page(PROD_PORT);
    const merge = html.indexOf('self.__wormholes__??=');
    const island = html.indexOf('<astro-island');

    expect(merge).toBeGreaterThan(-1);
    expect(island).toBeGreaterThan(-1);
    expect(merge).toBeLessThan(island);
  });

  test('config and counter values ride island merge scripts', async () => {
    const html = await page(PROD_PORT);

    expect(html).toContain('"config":{"siteName":"Astroscope Demo"');
    expect(html).toMatch(/"counter":\{"count":\d+\}/);
  });

  test('script-only wormholes are appended at stream end', async () => {
    const html = await page(PROD_PORT);
    const stats = html.indexOf('"stats":{"visitors":1234}');
    const lastIsland = html.lastIndexOf('<astro-island');

    expect(stats).toBeGreaterThan(lastIsland);
  });

  test('wormholes never read on the client are not delivered', async () => {
    const html = await page(PROD_PORT);

    expect(html).not.toContain('server-only-audit-marker');
    expect(html).not.toContain('"audit"');
  });
});

describe('prod loading (per route)', () => {
  test('a page loads only the wormholes its route reads', async () => {
    const before = await loads(PROD_PORT);

    await page(PROD_PORT);

    const after = await loads(PROD_PORT);

    // config and counter: frontmatter + islands; stats: the page script; audit: no reader
    expect((after['config'] ?? 0) - (before['config'] ?? 0)).toBe(1);
    expect((after['counter'] ?? 0) - (before['counter'] ?? 0)).toBe(1);
    expect((after['stats'] ?? 0) - (before['stats'] ?? 0)).toBe(1);
    expect(after['audit']).toBeUndefined();
  });

  test('an action loads only what its handler reads', async () => {
    const before = await loads(PROD_PORT);

    const res = await fetch(`http://localhost:${PROD_PORT}/_actions/updateCounter`, {
      method: 'POST',
      // the node adapter's csrf check wants a same-site origin on mutating requests
      headers: { 'content-type': 'application/json', origin: `http://localhost:${PROD_PORT}` },
      body: JSON.stringify({ count: 3 }),
    });

    expect(res.ok).toBe(true);

    const after = await loads(PROD_PORT);

    expect((after['counter'] ?? 0) - (before['counter'] ?? 0)).toBe(1);
    expect(after['config']).toBe(before['config']);
    expect(after['stats']).toBe(before['stats']);
  });

  test('a page without readers runs no handler', async () => {
    const before = await loads(PROD_PORT);

    await page(PROD_PORT, '/plain');

    expect(await loads(PROD_PORT)).toEqual(before);
  });

  test('the build records the server reads per route', async () => {
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(
      readFileSync(new URL('../dist/server/chunks/wormhole-manifest.json', import.meta.url), 'utf8'),
    ) as { routes: Record<string, string[]>; scripts: string[] };

    // frontmatter reads plus the page script's
    expect(manifest.routes['/']?.toSorted()).toEqual(['config', 'counter', 'stats']);
    expect(manifest.routes['/plain']).toEqual([]);
    expect(manifest.routes['/api/loads']).toEqual([]);
    expect(manifest.routes['/_actions/[...path]']).toEqual(['counter']);
    expect(manifest.scripts.toSorted()).toEqual(['counter', 'stats']);
  });
});

describe('dev loading (everything)', () => {
  test('every handler runs on every page', async () => {
    const before = await loads(DEV_PORT);

    await page(DEV_PORT, '/plain');

    const after = await loads(DEV_PORT);

    for (const name of ['config', 'counter', 'stats', 'audit']) {
      expect((after[name] ?? 0) - (before[name] ?? 0)).toBe(1);
    }
  });
});

describe('dev delivery (full)', () => {
  test('everything open lands in the head, before any island', async () => {
    const html = await page(DEV_PORT);
    const merge = html.indexOf('self.__wormholes__??=');

    expect(merge).toBeGreaterThan(-1);
    expect(merge).toBeLessThan(html.indexOf('<astro-island'));
    expect(html).toContain('"config"');
    expect(html).toContain('"counter"');
    expect(html).toContain('"stats"');
    // dev ships all open wormholes — parity is prod's job via the manifest
    expect(html).toContain('"audit"');
  });
});
