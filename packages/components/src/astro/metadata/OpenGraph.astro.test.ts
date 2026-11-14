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

  test('article tags switch og:type to article and normalize the dates to ISO 8601', async () => {
    const html = await render({
      siteName: 'Site',
      title: 'Hello',
      article: {
        publishedTime: '2030-01-01',
        modifiedTime: new Date('2030-06-15T12:00:00Z'),
        section: 'News',
        tags: ['robots', 'lawn'],
      },
    });

    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<meta property="article:published_time" content="2030-01-01T00:00:00.000Z">');
    expect(html).toContain('<meta property="article:modified_time" content="2030-06-15T12:00:00.000Z">');
    expect(html).toContain('<meta property="article:section" content="News">');
    expect(html).toContain('<meta property="article:tag" content="robots">');
    expect(html).toContain('<meta property="article:tag" content="lawn">');
  });

  test('an explicit ogType wins over the article default', async () => {
    const html = await render({ siteName: 'Site', title: 'Hello', ogType: 'video.other', article: { section: 'News' } });

    expect(html).toContain('<meta property="og:type" content="video.other">');
  });

  test('an unparseable article date is dropped', async () => {
    const html = await render({ siteName: 'Site', title: 'Hello', article: { publishedTime: 'not a date' } });

    expect(html).not.toContain('article:published_time');
  });

  test('renders no article tags without the article prop', async () => {
    const html = await render({ siteName: 'Site', title: 'Hello' });

    expect(html).not.toContain('property="article:');
  });
});
