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

const page = (port: number) => fetch(`http://localhost:${port}/`).then((r) => r.text());

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
