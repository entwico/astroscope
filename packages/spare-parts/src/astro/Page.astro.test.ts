import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

import Page from './Page.astro';

const URL = 'https://site.test/checkout';

const PROPS = {
  lang: 'en',
  siteName: 'Site',
  title: 'Home',
  description: 'Desc',
  canonical: '/checkout',
  ogImage: '/og.png',
  htmlClass: 'hc',
  bodyClass: 'bc',
  fonts: ['/a.woff2', { url: '/b.woff', type: 'font/woff' }],
  alternates: [{ hreflang: 'en', href: 'https://x/en' }],
};

const SLOTS = {
  default: '<p id="body">hi</p>',
  'head-early': '<link rel="preconnect" href="https://fonts.example">',
  head: '<link rel="icon" href="/fav.svg">',
};

describe('Page (kitchen sink)', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  const render = (props: Record<string, unknown> = PROPS) =>
    container.renderToString(Page, { props, request: new Request(URL), slots: SLOTS });

  test('renders the full document skeleton with html/body classes and the body slot', async () => {
    // partial: false renders the document as a full page so the doctype is emitted
    const html = await container.renderToString(Page, {
      props: PROPS,
      request: new Request(URL),
      slots: SLOTS,
      partial: false,
    });

    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).toContain('<html lang="en" class="hc">');
    // astro injects dev-only data-astro-source-* attrs on the body, so don't match the closing `>`
    expect(html).toContain('<body class="bc"');
    expect(html).toContain('<p id="body">hi</p>');
  });

  test('charset and viewport default, and are overridable', async () => {
    const html = await render();

    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');

    const custom = await render({ ...PROPS, charset: 'latin1', viewport: 'width=320' });

    expect(custom).toContain('<meta charset="latin1">');
    expect(custom).toContain('<meta name="viewport" content="width=320">');
  });

  test('head-early renders before viewport; the head slot is included', async () => {
    const html = await render();

    const early = html.indexOf('rel="preconnect"');
    const viewport = html.indexOf('name="viewport"');

    expect(early).toBeGreaterThan(-1);
    expect(early).toBeLessThan(viewport);
    expect(html).toContain('<link rel="icon" href="/fav.svg">');
  });

  test('preloads fonts from both string and object entries', async () => {
    const html = await render();

    expect(html).toMatch(/href="\/a\.woff2"[^>]*type="font\/woff2"/);
    expect(html).toMatch(/href="\/b\.woff"[^>]*type="font\/woff"/);
  });

  test('renders the page metadata into the head', async () => {
    const html = await render();

    expect(html).toContain('<title>Home</title>');
    expect(html).toContain('<link rel="canonical" href="https://site.test/checkout">');
    expect(html).toContain('<meta property="og:url" content="https://site.test/checkout">');
    expect(html).toContain('hreflang="en"');
    expect(html).not.toContain('name="robots"');
  });

  test('disableBfCache sets the no-store header and the guard script lives in the head', async () => {
    const res = await container.renderToResponse(Page, {
      props: { ...PROPS, disableBfCache: true },
      request: new Request(URL),
      slots: SLOTS,
    });

    expect(res.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');

    const html = await res.text();

    expect(html).toContain('pageshow');
    expect(html.indexOf('pageshow')).toBeLessThan(html.indexOf('</head>'));
  });

  test('no Cache-Control header without disableBfCache', async () => {
    const res = await container.renderToResponse(Page, { props: PROPS, request: new Request(URL), slots: SLOTS });

    expect(res.headers.get('cache-control')).toBeNull();
  });
});
