import { type Browser, type BrowserContext, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { type PageRecord, record } from './browser';
import { type DemoServer, startDemo } from './server';

const PORT = 14_431;

let server: DemoServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let seen: PageRecord;

beforeAll(async () => {
  [server, browser] = await Promise.all([startDemo('guards', PORT), chromium.launch()]);
});

afterAll(async () => {
  await browser?.close();
  await server?.stop();
});

// a context per test: nobody is signed in at its start
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  seen = record(page);
});

afterEach(async () => {
  await context.close();
});

const signInAs = (name: string) => page.getByRole('button', { name: `Sign in as ${name}` }).click();
const path = () => new URL(page.url()).pathname + new URL(page.url()).search;

describe('pages', () => {
  test('nobody is sent to sign in and lands on the page after it', async () => {
    await page.goto(`${server.origin}/me`);

    expect(path()).toBe('/?next=%2Fme');
    expect(await page.locator('.alert-warning').textContent()).toContain('/me');

    await signInAs('alice');
    await page.waitForURL(`${server.origin}/me`);

    expect(await page.locator('span.badge-primary').textContent()).toBe('alice');
  });

  test('the admin area is a 404 for a signed-in non-admin, at its own url', async () => {
    await page.goto(server.origin);
    await signInAs('alice');
    await page.waitForLoadState();

    const response = await page.goto(`${server.origin}/admin`);

    expect(response!.status()).toBe(404);
    expect(path()).toBe('/admin');
    expect(await page.locator('body').textContent()).toContain('There is nothing here.');
  });

  test('an admin gets in, and is out again after signing out', async () => {
    await page.goto(`${server.origin}/admin`);

    expect(path()).toBe('/?next=%2Fadmin');

    await signInAs('root');
    await page.waitForURL(`${server.origin}/admin`);

    expect(await page.locator('.card-title').textContent()).toBe('Admin area');

    await page.goto(server.origin);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForLoadState();
    await page.goto(`${server.origin}/admin`);

    expect(path()).toBe('/?next=%2Fadmin');
  });
});

describe('form action', () => {
  const rename = async (projectId: string, name: string) => {
    await page.locator('select[name="projectId"]').selectOption(projectId);
    await page.locator('input[name="name"]').fill(name);
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.waitForLoadState();
  };

  test('the owner\'s form post runs the action and renders its result', async () => {
    await page.goto(server.origin);
    await signInAs('alice');
    await page.waitForLoadState();
    await rename('p1', 'From the browser');

    expect(await page.locator('.alert-success').textContent()).toBe('Project p1 is now "From the browser".');
    expect(seen.errors).toEqual([]);
  });

  test('a denial renders as the action\'s error: someone else\'s project, then nobody', async () => {
    await page.goto(server.origin);
    await signInAs('alice');
    await page.waitForLoadState();
    await rename('p2', 'Taken over');

    expect(await page.locator('.alert-error').textContent()).toBe('FORBIDDEN: not your project');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForLoadState();
    await rename('p2', 'Taken over');

    expect(await page.locator('.alert-error').textContent()).toBe('UNAUTHORIZED: sign in first');
  });
});
