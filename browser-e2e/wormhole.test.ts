import { type Browser, type BrowserContext, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { type PageRecord, record } from './browser';
import { type DemoServer, startDemo } from './server';

const PORT = 14_421;

let server: DemoServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let seen: PageRecord;

beforeAll(async () => {
  [server, browser] = await Promise.all([startDemo('wormhole', PORT), chromium.launch()]);
});

afterAll(async () => {
  await browser?.close();
  await server?.stop();
});

beforeEach(async () => {
  // short enough to keep the `client:visible` island out of view on load
  context = await browser.newContext({ viewport: { width: 1000, height: 300 } });
  page = await context.newPage();
  seen = record(page);
});

afterEach(async () => {
  await context.close();
});

const delivered = () =>
  page.evaluate(() =>
    Object.keys((window as unknown as { __wormholes__?: object }).__wormholes__ ?? {}).toSorted((a, b) =>
      a.localeCompare(b)));

const counterIsland = () => page.locator('astro-island[component-url*="/Counter."]');
const scriptCounter = () => page.locator('#script-counter').textContent();

describe('delivery', () => {
  test('islands and the page script read what the stream delivered, and nothing else arrives', async () => {
    await page.goto(server.origin);

    await expect.poll(() => page.locator('#script-stats').textContent()).toBe('1234');
    await expect.poll(() => counterIsland().evaluate((el) => el.hasAttribute('ssr'))).toBe(false);

    expect(await scriptCounter()).toBe(await counterIsland().locator('span').textContent());
    expect(await delivered()).toEqual(['config', 'counter', 'stats']);
    expect(seen.errors).toEqual([]);
  });

  test('a visible island below the fold hydrates from the value merged ahead of it', async () => {
    await page.goto(server.origin);

    const config = page.locator('astro-island[component-url*="/ConfigDisplay."]');

    expect(await config.evaluate((el) => el.hasAttribute('ssr'))).toBe(true);

    await config.evaluate((el) => el.firstElementChild!.scrollIntoView());

    await expect.poll(() => config.evaluate((el) => el.hasAttribute('ssr'))).toBe(false);

    expect(await config.locator('p').textContent()).toContain('Astroscope Demo');
    expect(seen.errors).toEqual([]);
  });

  test('pages without client readers deliver nothing', async () => {
    for (const path of ['/plain', '/server-only']) {
      await page.goto(`${server.origin}${path}`);

      expect(await delivered(), path).toEqual([]);
    }

    expect(seen.errors).toEqual([]);
  });
});

describe('updates', () => {
  test('a set() in an island reaches the page script\'s subscription, and the server on reload', async () => {
    await page.goto(server.origin);

    await expect.poll(() => counterIsland().evaluate((el) => el.hasAttribute('ssr'))).toBe(false);

    const before = Number(await scriptCounter());

    await counterIsland().getByRole('button', { name: '+' }).click();

    await expect.poll(scriptCounter).toBe(String(before + 1));

    expect(await counterIsland().locator('span').textContent()).toBe(String(before + 1));

    await page.reload();

    await expect.poll(scriptCounter).toBe(String(before + 1));

    expect(seen.errors).toEqual([]);
  });
});
