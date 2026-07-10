import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

import PageMetadata from './PageMetadata.astro';

describe('PageMetadata', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  const render = (props: Record<string, unknown>) =>
    container.renderToString(PageMetadata, { props, request: new Request('https://site.test/page') });

  test('composes search and social metadata', async () => {
    const html = await render({ siteName: 'Site', title: 'Page Title', description: 'D' });

    expect(html).toContain('<title>Page Title</title>');
    expect(html).toContain('<meta name="description" content="D">');
    expect(html).toContain('<meta property="og:title" content="Page Title">');
    expect(html).toContain('<meta property="og:site_name" content="Site">');
  });

  test('og:title uses the ogTitle override while <title> keeps the page title', async () => {
    const html = await render({ siteName: 'Site', title: 'Page Title', ogTitle: 'Social' });

    expect(html).toContain('<title>Page Title</title>');
    expect(html).toContain('<meta property="og:title" content="Social">');
  });

  test('an empty og override still falls back to the page value', async () => {
    const html = await render({
      siteName: 'Site',
      title: 'Page Title',
      description: 'D',
      ogTitle: '',
      ogDescription: '',
    });

    expect(html).toContain('<meta property="og:title" content="Page Title">');
    expect(html).toContain('<meta property="og:description" content="D">');
  });
});
