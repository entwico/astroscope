import { type Browser, type BrowserContext, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { type PageRecord, record, requestPaths } from './browser';
import { type DemoServer, startDemo } from './server';

const PORT = 14_411;

// every module answers this late: a dependency found only after its importer arrived starts at
// least one delay after it, modules announced up front start together
const MODULE_DELAY_MS = 250;

// the visible island of /deferred sits below the fold of this viewport and beyond the gate's
// one-viewport margin
const VIEWPORT = { width: 1000, height: 300 };

type Registry = Record<string, { l: string[]; i?: string[] }>;

let server: DemoServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let seen: PageRecord;

beforeAll(async () => {
  [server, browser] = await Promise.all([startDemo('i18n', PORT), chromium.launch()]);
});

afterAll(async () => {
  await browser?.close();
  await server?.stop();
});

beforeEach(async () => {
  context = await browser.newContext({ viewport: VIEWPORT });
  page = await context.newPage();
  seen = record(page);
});

afterEach(async () => {
  await context.close();
});

async function delayModules(): Promise<void> {
  await page.route(/\/(_astro|_i18n)\/.*\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, MODULE_DELAY_MS));
    await route.continue();
  });
}

const island = (component: string) => page.locator(`astro-island[component-url*="/${component}."]`).first();

// astro removes the `ssr` attribute once the island hydrated
const hydrated = (component: string) => async () => !(await island(component).evaluate((el) => el.hasAttribute('ssr')));

async function register(component: string): Promise<{ l: string[]; i: string[] }> {
  const registry = await page.evaluate(() => (window as unknown as { __islands__: Registry }).__islands__);
  const url = Object.keys(registry).find((key) => key.includes(`/${component}.`));

  expect(url, `no register for ${component}`).toBeDefined();

  return { l: registry[url!]!.l, i: registry[url!]!.i ?? [] };
}

/** when the page started fetching each url, by resource timing; a url it never fetched is missing */
function startTimes(urls: string[]): Promise<Record<string, number>> {
  return page.evaluate((wanted) => {
    const starts: Record<string, number> = {};

    for (const entry of performance.getEntriesByType('resource')) {
      const { pathname } = new URL(entry.name);

      if (wanted.includes(pathname)) starts[pathname] ??= entry.startTime;
    }

    return starts;
  }, urls);
}

const spread = (starts: Record<string, number>) =>
  Math.max(...Object.values(starts)) - Math.min(...Object.values(starts));

const sorted = (urls: string[]) => urls.toSorted((a, b) => a.localeCompare(b));

const duplicates = (paths: string[]) => paths.filter((path, index) => paths.indexOf(path) !== index);

describe('deferred islands', () => {
  test('an idle island\'s modules and translations start together, not as a waterfall', async () => {
    await delayModules();
    await page.goto(`${server.origin}/deferred`);

    await expect.poll(hydrated('Newsletter')).toBe(true);

    const { l, i } = await register('Newsletter');
    const starts = await startTimes([...l, ...i]);

    expect(l.length).toBeGreaterThan(1);
    expect(i.length).toBeGreaterThan(0);
    expect(sorted(Object.keys(starts))).toEqual(sorted([...l, ...i]));
    expect(spread(starts)).toBeLessThan(MODULE_DELAY_MS);
  });

  test('a visible island is preloaded a viewport ahead and hydrates only in view', async () => {
    await page.goto(`${server.origin}/deferred`);

    await expect.poll(hydrated('Newsletter')).toBe(true);

    const { l, i } = await register('CircularB');
    // what only this island brings: the rest of its closure is shared with the idle islands
    const own = [...l, ...i].filter((url) => !requestPaths(seen.requests, /./).includes(url));

    expect(own.some((url) => url.includes('/CircularB.'))).toBe(true);
    expect(own.some((url) => url.startsWith('/_i18n/'))).toBe(true);

    // into the margin, still out of view
    await page.evaluate(() => {
      const target = document.querySelector('astro-island[client="visible"]')!.firstElementChild!;

      window.scrollBy(0, target.getBoundingClientRect().top - window.innerHeight - 100);
    });

    await expect.poll(async () => sorted(Object.keys(await startTimes(own)))).toEqual(sorted(own));

    expect(await hydrated('CircularB')()).toBe(false);

    await island('CircularB').evaluate((el) => el.firstElementChild!.scrollIntoView());

    await expect.poll(hydrated('CircularB')).toBe(true);

    expect(duplicates(requestPaths(seen.requests, /^\/(_astro|_i18n)\//))).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test('a lazy chunk\'s translations are in the module cache before the chunk is asked for', async () => {
    await page.goto(`${server.origin}/deferred?locale=de`);

    await expect.poll(hydrated('LazyLoadDemo')).toBe(true);

    const translations = () => requestPaths(seen.requests, /^\/_i18n\/de\/StatsModal\./);

    expect(translations()).toHaveLength(1);
    expect(requestPaths(seen.requests, /^\/_astro\/StatsModal\./)).toEqual([]);

    await page.getByRole('button', { name: 'Meine Statistiken' }).click();
    await page.getByText('Ihre Statistiken').waitFor();

    expect(requestPaths(seen.requests, /^\/_astro\/StatsModal\./)).toHaveLength(1);
    expect(translations()).toHaveLength(1);
    expect(seen.errors).toEqual([]);
  });
});

describe('immediate islands', () => {
  test('the modules the document links are fetched together, each once', async () => {
    await delayModules();

    const response = await page.goto(server.origin);
    const html = await response!.text();
    const linked = html
      .matchAll(/<link rel="modulepreload"[^>]* href="([^"]+)"/g)
      .map((match) => match[1]!)
      .toArray();

    await expect.poll(hydrated('Cart')).toBe(true);

    const starts = await startTimes(linked);

    expect(linked.some((url) => url.includes('/Cart.'))).toBe(true);
    expect(linked.some((url) => url.startsWith('/_i18n/en/Cart.'))).toBe(true);
    expect(sorted(Object.keys(starts))).toEqual(sorted([...new Set(linked)]));
    expect(spread(starts)).toBeLessThan(MODULE_DELAY_MS);
  });

  test('a page of every directive hydrates top to bottom without fetching a module twice', async () => {
    await page.goto(server.origin);

    // the islands inside the `display: none` block never become visible
    const pending = () =>
      page.evaluate(() => {
        const waiting = [...document.querySelectorAll('astro-island[ssr]')].filter(
          (el) => el.firstElementChild && (el.firstElementChild as HTMLElement).offsetParent !== null,
        );

        waiting[0]?.firstElementChild!.scrollIntoView();

        return waiting.length;
      });

    await expect.poll(pending, { timeout: 20_000 }).toBe(0);

    expect(duplicates(requestPaths(seen.requests, /^\/(_astro|_i18n)\//))).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});

describe('translations in the browser', () => {
  test('an island hydrates and re-renders in the request locale', async () => {
    await page.goto(`${server.origin}/deferred?locale=de`);

    const newsletter = island('Newsletter');

    await expect.poll(hydrated('Newsletter')).toBe(true);

    expect(await newsletter.locator('h3').textContent()).toBe('Bleiben Sie informiert');

    await newsletter.getByPlaceholder('E-Mail eingeben').fill('a@example.com');
    await newsletter.getByRole('button', { name: 'Abonnieren' }).click();
    await newsletter.getByText('Danke für Ihre Anmeldung!').waitFor();

    expect(await page.evaluate(() => (window as unknown as { __i18n__: { locale: string } }).__i18n__.locale)).toBe('de');
    expect(seen.errors).toEqual([]);
  });
});
