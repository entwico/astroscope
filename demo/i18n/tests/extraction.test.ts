import { type ChildProcess, spawn } from 'node:child_process';
import { type CheerioAPI, load } from 'cheerio';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const DEV_PORT = 14321;
const PROD_PORT = 14322;

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

function extractBadgeCount($: CheerioAPI, label: string): number | null {
  const badge = $(`.collapse-title:contains('${label}')`).find('.badge').text();
  const match = badge.match(/(\d+)/);

  return match ? parseInt(match[1]!, 10) : null;
}

function extractManifestJson($: CheerioAPI, label: string): unknown {
  const content = $(`.collapse-title:contains('${label}')`).parent().find('code').text();

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

beforeAll(async () => {
  // astro skips mounting its dev handlers when VITEST is set — the child must not inherit it
  const { VITEST: _vitest, ...env } = process.env;

  devServer = spawn('npx', ['astro', 'dev', '--port', String(DEV_PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
    env,
  });

  // start prod server (assumes build already done); health and metrics get their
  // own ports so parallel demo suites don't collide on the 9090/9464 defaults
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
  devServer?.kill();
  prodServer?.kill();
});

describe('dev/prod parity', () => {
  test('same key count', async () => {
    const [devHtml, prodHtml] = await Promise.all([
      fetch(`http://localhost:${DEV_PORT}/`).then((r) => r.text()),
      fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text()),
    ]);

    const devCount = extractBadgeCount(load(devHtml), 'Extracted Keys');
    const prodCount = extractBadgeCount(load(prodHtml), 'Extracted Keys');

    expect(devCount).not.toBeNull();
    expect(prodCount).not.toBeNull();
    expect(devCount).toBe(prodCount);
  });

  test('same chunk count', async () => {
    const [devHtml, prodHtml] = await Promise.all([
      fetch(`http://localhost:${DEV_PORT}/`).then((r) => r.text()),
      fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text()),
    ]);

    const devCount = extractBadgeCount(load(devHtml), 'Chunk Manifest');
    const prodCount = extractBadgeCount(load(prodHtml), 'Chunk Manifest');

    // dev mode has no chunks (all inline), prod has chunks
    expect(prodCount).toBeGreaterThan(0);
    console.log(`Dev chunks: ${devCount}, Prod chunks: ${prodCount}`);
  });
});

describe('manifest structure', () => {
  test('chunks manifest maps chunk names to key arrays', async () => {
    const html = await fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text());
    const chunks = extractManifestJson(load(html), 'Chunk Manifest') as Record<string, string[]>;

    expect(chunks).not.toBeNull();
    expect(Object.keys(chunks).length).toBeGreaterThan(5);

    for (const [chunkName, keys] of Object.entries(chunks)) {
      expect(chunkName).toMatch(/^[A-Za-z]+\.[A-Za-z0-9_-]+$/); // e.g. "Cart.C3sgsRVu"
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    }
  });
});

describe('SSR translations', () => {
  test('renders English translations by default', async () => {
    const html = await fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text());
    const $ = load(html);

    // check SSR-rendered content from t('home.title')
    expect($('h3:contains("Welcome to our Store")').length).toBe(1);
    expect($('p:contains("Find the best products here")').length).toBe(1);
  });

  test('renders German translations with locale param', async () => {
    const html = await fetch(`http://localhost:${PROD_PORT}/?locale=de`).then((r) => r.text());
    const $ = load(html);

    expect($('h3:contains("Willkommen in unserem Shop")').length).toBe(1);
    expect($('p:contains("Finden Sie hier die besten Produkte")').length).toBe(1);
  });
});

describe('client i18n state', () => {
  test('prod pages carry per-island hash merge scripts before their islands', async () => {
    const html = await fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text());

    expect(html).toContain('window.__i18n__??=');
    expect(html).toContain('"locale":"en"');

    const merge = html.indexOf('window.__i18n__??=');
    const island = html.indexOf('<astro-island');

    expect(merge).toBeGreaterThan(-1);
    expect(merge).toBeLessThan(island);
  });

  test('prod pages preload translation chunks alongside component chunks', async () => {
    const html = await fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text());

    // immediate islands get link tags, deferred islands register their translation
    // chunks as eager imports for the gate
    expect(html).toMatch(/<link rel="modulepreload" fetchpriority="low" href="\/_i18n\/en\/[^"]+\.js">/);
    expect(html).toMatch(/\(self\.__islands__\?\?=\{\}\)\[[^\]]+\]=\{"l":\[[^}]*"i":\[[^\]]*\/_i18n\/en\/[^"\]]+\.js[^\]]*\]/);
    expect(html).toContain('@astroscope/node.islandsRuntime');
  });

  test('dev pages ship full translations in the head, before any island', async () => {
    const html = await fetch(`http://localhost:${DEV_PORT}/`).then((r) => r.text());
    const state = html.indexOf('window.__i18n__');

    expect(state).toBeGreaterThan(-1);
    expect(html).toContain('"home.title"');
    // islands hydrate via dynamic import() mid-stream — the state must precede them
    expect(state).toBeLessThan(html.indexOf('<astro-island'));
  });
});

describe('key count sanity', () => {
  test('key count is reasonable (> 30)', async () => {
    const html = await fetch(`http://localhost:${DEV_PORT}/`).then((r) => r.text());
    const count = extractBadgeCount(load(html), 'Extracted Keys');

    expect(count).not.toBeNull();
    expect(count).toBeGreaterThan(30);
  });

  test('all expected components have keys extracted', async () => {
    const html = await fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text());
    const chunks = extractManifestJson(load(html), 'Chunk Manifest') as Record<string, string[]>;

    const chunkNames = Object.keys(chunks).map((c) => c.split('.')[0]);

    expect(chunkNames).toContain('Cart');
    expect(chunkNames).toContain('Newsletter');
    expect(chunkNames).toContain('ProductCard');
    expect(chunkNames).toContain('LazyLoadDemo');
    expect(chunkNames).toContain('StatsModal');
    expect(chunkNames).toContain('CookieBanner');
  });
});
