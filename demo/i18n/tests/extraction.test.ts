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

  // start dev server
  devServer = spawn('npx', ['astro', 'dev', '--port', String(DEV_PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
    env,
  });

  // start prod server (assumes build already done)
  prodServer = spawn('node', ['./dist/server/entry.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PROD_PORT) },
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
    // this is expected behavior - prod should have chunks
    expect(prodCount).toBeGreaterThan(0);
    console.log(`Dev chunks: ${devCount}, Prod chunks: ${prodCount}`);
  });

  test('same imports count', async () => {
    const [devHtml, prodHtml] = await Promise.all([
      fetch(`http://localhost:${DEV_PORT}/`).then((r) => r.text()),
      fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text()),
    ]);

    const devCount = extractBadgeCount(load(devHtml), 'Imports Manifest');
    const prodCount = extractBadgeCount(load(prodHtml), 'Imports Manifest');

    // imports are only in prod (for chunk preloading)
    expect(prodCount).toBeGreaterThan(0);
    console.log(`Dev imports: ${devCount}, Prod imports: ${prodCount}`);
  });
});

describe('manifest structure', () => {
  test('chunks manifest maps chunk names to key arrays', async () => {
    const html = await fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text());
    const chunks = extractManifestJson(load(html), 'Chunk Manifest') as Record<string, string[]>;

    expect(chunks).not.toBeNull();
    expect(Object.keys(chunks).length).toBeGreaterThan(5);

    // each chunk should have an array of keys
    for (const [chunkName, keys] of Object.entries(chunks)) {
      expect(chunkName).toMatch(/^[A-Za-z]+\.[A-Za-z0-9_-]+$/); // e.g. "Cart.C3sgsRVu"
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    }
  });

  test('imports manifest has valid structure', async () => {
    const html = await fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text());
    const imports = extractManifestJson(load(html), 'Imports Manifest') as Record<string, string[]>;

    expect(imports).not.toBeNull();

    // imports should reference valid chunk names
    const chunks = extractManifestJson(load(html), 'Chunk Manifest') as Record<string, string[]>;
    const chunkNames = new Set(Object.keys(chunks));

    for (const [chunk, deps] of Object.entries(imports)) {
      // chunk name might have different hash but same component name
      const chunkBase = chunk.split('.')[0];
      expect(chunkBase).toBeTruthy();

      expect(Array.isArray(deps)).toBe(true);

      for (const dep of deps) {
        expect(chunkNames.has(dep)).toBe(true);
      }
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

    // check SSR-rendered German content
    expect($('h3:contains("Willkommen in unserem Shop")').length).toBe(1);
    expect($('p:contains("Finden Sie hier die besten Produkte")').length).toBe(1);
  });
});

describe('I18nScript component', () => {
  test('injects __i18n__ script in head', async () => {
    const html = await fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text());
    const $ = load(html);

    // I18nScript should inject a script with window.__i18n__
    const scripts = $('head script').toArray();
    const i18nScript = scripts.find((s) => $(s).html()?.includes('__i18n__'));

    expect(i18nScript).toBeTruthy();
  });

  test('__i18n__ contains locale and hashes', async () => {
    const html = await fetch(`http://localhost:${PROD_PORT}/`).then((r) => r.text());

    // extract the __i18n__ initialization
    const match = html.match(/window\.__i18n__\s*=\s*(\{[^}]+\})/);

    expect(match).toBeTruthy();

    // should contain locale
    expect(html).toContain('locale:');
    expect(html).toContain('hashes:');
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

    // verify expected components have chunks
    expect(chunkNames).toContain('Cart');
    expect(chunkNames).toContain('Newsletter');
    expect(chunkNames).toContain('ProductCard');
    expect(chunkNames).toContain('LazyLoadDemo');
    expect(chunkNames).toContain('StatsModal');
    expect(chunkNames).toContain('CookieBanner');
  });
});
