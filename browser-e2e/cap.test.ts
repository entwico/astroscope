import { type Browser, type BrowserContext, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { startCapStub } from '../demo/cap/stub/cap-service.mjs';
import { type PageRecord, foreignRequests, record, requestPaths } from './browser';
import { type DemoServer, startDemo } from './server';

const PORT = 14_401;
const STUB_PORT = 14_405;

let server: DemoServer;
let stub: ReturnType<typeof startCapStub>;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let seen: PageRecord;

beforeAll(async () => {
  stub = startCapStub({ port: STUB_PORT });

  await stub.listening;

  [server, browser] = await Promise.all([
    startDemo('cap', PORT, { CAP_BASE_URL: `http://localhost:${STUB_PORT}` }),
    chromium.launch(),
  ]);
});

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  await stub?.close();
});

beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  seen = record(page);
});

afterEach(async () => {
  await context.close();
});

const redeems = () => requestPaths(seen.requests, /^\/_cap\/redeem$/).length;

async function subscribe(email: string): Promise<void> {
  await page.getByLabel('Email').fill(email);

  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/_actions/subscribe')),
    page.getByRole('button', { name: 'Subscribe' }).click(),
  ]);
}

const newsletterStatus = () => page.locator('form').first().locator('span.text-sm');
const contactForm = () => page.locator('form').nth(1);

describe('invisible captcha', () => {
  test('solving and the guarded action stay on the page origin', async () => {
    await page.goto(server.origin);
    await subscribe('a@example.com');

    await expect.poll(() => newsletterStatus().textContent()).toMatch(/^subscribed a@example\.com/);

    expect(redeems()).toBe(1);
    expect(foreignRequests(seen.requests, server.origin)).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test('solving starts on focus, and the submit uses that token', async () => {
    await page.goto(server.origin);

    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/_cap/redeem')),
      page.getByLabel('Email').focus(),
    ]);

    await subscribe('b@example.com');

    await expect.poll(() => newsletterStatus().textContent()).toMatch(/^subscribed b@example\.com/);

    expect(redeems()).toBe(1);
  });

  test('every submit solves anew, through one hidden widget', async () => {
    await page.goto(server.origin);
    await subscribe('c1@example.com');

    const widgets = await page.locator('cap-widget').count();

    await subscribe('c2@example.com');
    await subscribe('c3@example.com');

    await expect.poll(() => newsletterStatus().textContent()).toMatch(/^subscribed c3@example\.com/);

    expect(redeems()).toBe(3);
    expect(await page.locator('cap-widget').count()).toBe(widgets);
  });
});

describe('widget', () => {
  const token = () => contactForm().locator('input[name="_cap"]').inputValue();

  test('the checkbox solves, one submit consumes the token and resets the widget', async () => {
    await page.goto(server.origin);
    await contactForm().getByLabel('Name').fill('n');
    await contactForm().getByLabel('Message').fill('m');
    await contactForm().locator('cap-widget .captcha-trigger').click();

    await expect.poll(token).toMatch(/^demo:/);

    await contactForm().getByRole('button', { name: 'Send' }).click();

    await expect.poll(() => contactForm().locator('span.text-sm').textContent()).toBe('received: n: m');
    await expect.poll(token).toBe('');

    expect(foreignRequests(seen.requests, server.origin)).toEqual([]);
    expect(seen.errors).toEqual([]);
  });

  test('an unsolved required widget blocks the form submit', async () => {
    await page.goto(server.origin);
    await contactForm().getByLabel('Name').fill('n');
    await contactForm().getByLabel('Message').fill('m');
    await contactForm().locator('cap-widget .captcha-trigger').waitFor();
    await contactForm().getByRole('button', { name: 'Send' }).click();

    expect(await contactForm().evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(false);
    expect(requestPaths(seen.requests, /^\/_actions\//)).toEqual([]);
  });

  test('the credits link opens the vendor site without the page url, a referrer or an opener', async () => {
    const vendorRequests: { url: string; referer: string | undefined }[] = [];

    // the vendor site is never reached: the popup's navigation is answered here
    await context.route('https://trycap.dev/**', async (route) => {
      vendorRequests.push({ url: route.request().url(), referer: route.request().headers()['referer'] });

      await route.fulfill({ contentType: 'text/html', body: '<title>vendor</title>' });
    });

    await page.goto(server.origin);

    const credits = contactForm().locator('cap-widget .credits');

    await expect.poll(() => credits.getAttribute('rel')).toBe('nofollow noopener noreferrer');

    const [popup] = await Promise.all([context.waitForEvent('page'), credits.click()]);

    await popup.waitForLoadState();

    expect(vendorRequests).toHaveLength(1);
    expect(new URL(vendorRequests[0]!.url).search).toBe('');
    expect(vendorRequests[0]!.referer).toBeUndefined();
    expect(await popup.evaluate(() => ({ opener: window.opener as unknown, referrer: document.referrer }))).toEqual({
      opener: null,
      referrer: '',
    });
    // the click was taken over: the page itself went nowhere
    expect(page.url()).toBe(`${server.origin}/`);
  });

  test('a plain form posts the token the widget wrote into its hidden field', async () => {
    await page.goto(`${server.origin}/plain`);
    await page.getByLabel('Name').fill('n');
    await page.locator('cap-widget .captcha-trigger').click();

    await expect.poll(() => page.locator('input[name="_cap"]').inputValue()).toMatch(/^demo:/);

    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText('Verified').waitFor();

    expect(foreignRequests(seen.requests, server.origin)).toEqual([]);
    expect(seen.errors).toEqual([]);
  });
});

describe('content security policy', () => {
  // astro's island bootstrap is inline script, the widget styles its shadow root inline and paints
  // its background from a `data:` svg: all the site's own business around the two solver directives
  const policy = (scriptSources: string, ...directives: string[]) =>
    [
      'default-src \'self\'',
      `script-src 'self' 'unsafe-inline' ${scriptSources}`.trim(),
      'style-src \'self\' \'unsafe-inline\'',
      'img-src \'self\' data:',
      ...directives,
    ].join('; ');

  async function serveWith(csp: string): Promise<void> {
    await page.route(`${server.origin}/`, async (route) => {
      const response = await route.fetch();

      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
    });
  }

  test('`worker-src blob:` and `\'wasm-unsafe-eval\'` are enough to solve', async () => {
    await serveWith(policy('\'wasm-unsafe-eval\'', 'worker-src blob:'));
    await page.goto(server.origin);
    await subscribe('csp@example.com');

    await expect.poll(() => newsletterStatus().textContent()).toMatch(/^subscribed csp@example\.com/);

    expect(seen.errors).toEqual([]);
  });

  test('a policy refusing workers fails the solve, not the page', async () => {
    await serveWith(policy('\'wasm-unsafe-eval\''));
    await page.goto(server.origin);
    await page.getByLabel('Email').fill('csp@example.com');
    await page.getByRole('button', { name: 'Subscribe' }).click();

    await expect.poll(() => newsletterStatus().textContent(), { timeout: 20_000 }).toMatch(/^solving failed/);

    expect(requestPaths(seen.requests, /^\/_actions\//)).toEqual([]);
    expect(seen.uncaught).toEqual([]);
  });

  test('a policy refusing webassembly still solves, on the javascript solver', async () => {
    await serveWith(policy('', 'worker-src blob:'));
    await page.goto(server.origin);
    await subscribe('csp@example.com');

    await expect.poll(() => newsletterStatus().textContent()).toMatch(/^subscribed csp@example\.com/);

    // the client tells the service that it solves without webassembly
    expect(seen.requests.map((request) => new URL(request.url).search)).toContain('?wasm=0');
    expect(seen.uncaught).toEqual([]);
  });
});
