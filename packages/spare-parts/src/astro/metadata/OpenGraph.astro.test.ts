import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

import OpenGraph from './OpenGraph.astro';

describe('OpenGraph', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  const render = (props: Record<string, unknown>, url = 'https://site.test/page') =>
    container.renderToString(OpenGraph, { props, request: new Request(url) });

  test('renders og:type website and og:site_name by default', async () => {
    const html = await render({ siteName: 'Site', title: 'Hello' });

    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<meta property="og:site_name" content="Site">');
  });

  test('mirrors title/description into og and twitter tags', async () => {
    const html = await render({ siteName: 'Site', title: 'Hello', description: 'D' });

    expect(html).toContain('<meta property="og:title" content="Hello">');
    expect(html).toContain('<meta name="twitter:title" content="Hello">');
    expect(html).toContain('<meta property="og:description" content="D">');
    expect(html).toContain('<meta name="twitter:description" content="D">');
  });

  test('og:url falls back to the current page url (without query)', async () => {
    const html = await render({ siteName: 'Site', title: 'Hello' }, 'https://site.test/page?x=1');

    expect(html).toContain('<meta property="og:url" content="https://site.test/page/">');
  });

  test('og:url uses an explicit canonical, absolutized', async () => {
    const html = await render({ siteName: 'Site', title: 'Hello', canonical: '/c' }, 'https://site.test/page');

    expect(html).toContain('<meta property="og:url" content="https://site.test/c">');
  });

  test('absolutizes a relative image and upgrades the twitter card', async () => {
    const html = await render({ siteName: 'Site', title: 'Hello', ogImage: '/og.png' }, 'https://site.test/page');

    expect(html).toContain('<meta property="og:image" content="https://site.test/og.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  test('twitter:card defaults to summary without an image', async () => {
    const html = await render({ siteName: 'Site', title: 'Hello' });

    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });
});
