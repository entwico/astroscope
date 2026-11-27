import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const PORT = 14_441;
const ORIGIN = `http://localhost:${PORT}`;

const fixtureRoot = path.resolve(import.meta.dirname, '../demo/node-dev-e2e');
const bootFile = path.join(fixtureRoot, 'src/boot.ts');
const bootSource = readFileSync(bootFile, 'utf8');

let devServer: ChildProcess;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  // astro skips mounting its dev handlers when VITEST is set, and under vitest's NODE_ENV=test
  // the dev server pushes no reload to its pages — the child must not inherit either
  const { VITEST: _vitest, NODE_ENV: _nodeEnv, ...env } = process.env;

  devServer = spawn('npx', ['astro', 'dev', '--port', String(PORT)], { cwd: fixtureRoot, stdio: 'ignore', env });
  browser = await chromium.launch();
  page = await browser.newPage();

  const deadline = Date.now() + 50_000;

  for (;;) {
    try {
      const response = await fetch(`${ORIGIN}/slow?delay=0`);

      if (response.ok) return;
    } catch {
      // server not ready yet
    }

    if (Date.now() > deadline) throw new Error(`astro dev did not start on ${ORIGIN}`);

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

afterAll(async () => {
  writeFileSync(bootFile, bootSource);

  await browser?.close();

  // astro dev daemonizes under @astroscope/node — killing the wrapper is not enough
  spawn('npx', ['astro', 'dev', 'stop'], { cwd: fixtureRoot, stdio: 'ignore' });
  devServer?.kill();
});

const rendered = () => page.locator('p').first().textContent();

// a marker on the window is gone once the document was replaced
const mark = () => page.evaluate(() => Object.assign(window, { marked: true }));
const marked = () => page.evaluate(() => 'marked' in window);

describe('boot-file change with a page open', () => {
  test('a boot that fails turns the open page into the holding page with its error, and the fix brings it back', async () => {
    // the reload is pushed over vite's socket: a page not yet connected would never hear of it
    await Promise.all([
      page.waitForEvent('console', (message) => message.text().includes('[vite] connected')),
      page.goto(`${ORIGIN}/slow?delay=0`),
    ]);

    const value = await rendered();

    try {
      writeFileSync(bootFile, `${bootSource}\nthrow new Error('boot broke on purpose');\n`);

      await expect.poll(() => page.title(), { timeout: 30_000 }).toBe('Boot failed');

      expect(await page.locator('.error-body').textContent()).toContain('boot broke on purpose');
      expect(page.url()).toBe(`${ORIGIN}/slow?delay=0`);
    } finally {
      writeFileSync(bootFile, bootSource);
    }

    await expect.poll(rendered, { timeout: 30_000 }).toBe(value);

    expect(page.url()).toBe(`${ORIGIN}/slow?delay=0`);
  }, 90_000);

  test('a boot that succeeds reloads the open page by itself', async () => {
    await page.goto(`${ORIGIN}/slow?delay=0`);
    await mark();

    try {
      writeFileSync(bootFile, `${bootSource}\n// touched at ${Date.now()}\n`);

      await expect.poll(marked, { timeout: 30_000 }).toBe(false);
      await expect.poll(() => page.locator('p').count(), { timeout: 30_000 }).toBeGreaterThan(0);

      expect(page.url()).toBe(`${ORIGIN}/slow?delay=0`);
    } finally {
      writeFileSync(bootFile, bootSource);
    }
  }, 90_000);
});
