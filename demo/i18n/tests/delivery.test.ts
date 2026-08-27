import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

/**
 * Prod delivery of translation chunks through the islands pipeline: the gate
 * runtime is inlined (installs at parse time, no fetch to lose) and each
 * island's full-closure translation chunks — shared and lazy included — ride
 * the register scripts as eager imports.
 */

const PROD_PORT = 14331;
const BASE = `http://localhost:${PROD_PORT}`;

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

type RegistryEntry = { l: string[]; i?: string[] };

function parseRegisters(html: string): Record<string, RegistryEntry> {
  const registers: Record<string, RegistryEntry> = {};

  for (const match of html.matchAll(/\(self\.__islands__\?\?=\{\}\)\[("[^"]+")\]=(\{.*?\});<\/script>/g)) {
    registers[JSON.parse(match[1]!) as string] = JSON.parse(match[2]!) as RegistryEntry;
  }

  return registers;
}

function registerFor(registers: Record<string, RegistryEntry>, component: string): RegistryEntry {
  const url = Object.keys(registers).find((key) => key.includes(`/${component}.`));

  expect(url, `no register script for ${component}`).toBeDefined();

  return registers[url!]!;
}

beforeAll(async () => {
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

  await waitForServer(PROD_PORT);
}, 60000);

afterAll(() => {
  prodServer?.kill();
});

describe('gate runtime delivery', () => {
  test('the runtime is inlined before the first register script, never fetched', async () => {
    const html = await fetch(`${BASE}/deferred`).then((r) => r.text());

    expect(html).toContain('@astroscope/node.islandsRuntime');
    expect(html).not.toMatch(/<script[^>]*src="[^"]*islands-runtime/);
    expect(html.indexOf('@astroscope/node.islandsRuntime')).toBeLessThan(html.indexOf('__islands__??='));
    expect(html.indexOf('@astroscope/node.islandsRuntime')).toBeLessThan(html.indexOf('<astro-island'));
  });

  test('no runtime asset is emitted into the client build', () => {
    const assetsDir = new URL('../dist/client/_astro', import.meta.url).pathname;

    expect(existsSync(assetsDir)).toBe(true);
    expect(readdirSync(assetsDir).filter((f) => f.startsWith('islands-runtime'))).toEqual([]);
  });
});

describe('deferred islands — translation chunks as eager imports', () => {
  test('every register carries its translations in the import set, never as preload links', async () => {
    const html = await fetch(`${BASE}/deferred`).then((r) => r.text());
    const registers = parseRegisters(html);

    expect(Object.keys(registers).length).toBeGreaterThanOrEqual(3);

    for (const [url, entry] of Object.entries(registers)) {
      expect(entry.l.filter((link) => link.includes('/_i18n/')), `links of ${url}`).toEqual([]);
      expect(entry.i, `imports of ${url}`).toBeDefined();
      expect(entry.i!.every((imp) => imp.startsWith('/_i18n/en/')), `imports of ${url}`).toBe(true);
    }

    expect(registerFor(registers, 'Newsletter').i).toContainEqual(expect.stringMatching(/\/_i18n\/en\/Newsletter\./));
  });

  test('a chunk shared between islands rides every island that reaches it', async () => {
    const html = await fetch(`${BASE}/deferred`).then((r) => r.text());
    // CircularB's t() keys live in the CircularA chunk both islands share
    const imports = registerFor(parseRegisters(html), 'CircularB').i;

    expect(imports).toContainEqual(expect.stringMatching(/\/_i18n\/en\/CircularA\./));
  });

  test('a lazy chunk behind a dynamic import is covered by the import set', async () => {
    const html = await fetch(`${BASE}/deferred`).then((r) => r.text());
    const imports = registerFor(parseRegisters(html), 'LazyLoadDemo').i;

    expect(imports).toContainEqual(expect.stringMatching(/\/_i18n\/en\/LazyLoadDemo\./));
    expect(imports).toContainEqual(expect.stringMatching(/\/_i18n\/en\/StatsModal\./));
  });

  test('the locale rides the import urls', async () => {
    const html = await fetch(`${BASE}/deferred?locale=de`).then((r) => r.text());
    const imports = registerFor(parseRegisters(html), 'Newsletter').i;

    expect(imports).toContainEqual(expect.stringMatching(/\/_i18n\/de\/Newsletter\./));
  });
});

describe('immediate islands — untouched ideal path', () => {
  test('static-closure translations stay server-emitted preload links', async () => {
    const html = await fetch(`${BASE}/`).then((r) => r.text());

    expect(html).toMatch(/<link rel="modulepreload" fetchpriority="low" href="\/_i18n\/en\/Cart\.[^"]+\.js">/);
  });

  test('an eagerly imported translation chunk is servable and idempotent', async () => {
    const html = await fetch(`${BASE}/deferred`).then((r) => r.text());
    const imports = registerFor(parseRegisters(html), 'Newsletter').i!;
    const res = await fetch(`${BASE}${imports.find((imp) => imp.includes('/Newsletter.'))}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');

    const body = await res.text();

    // evaluation must be safe ahead of the component: assign-only, guarded
    expect(body).toContain('window.__i18n__');
    expect(body).toContain('Object.assign');
  });
});
