import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

import PreloadFont from './PreloadFont.astro';

describe('PreloadFont', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  test('renders a crossorigin font preload link, defaulting to woff2', async () => {
    const html = await container.renderToString(PreloadFont, { props: { url: '/font.woff2' } });

    expect(html).toContain('rel="preload"');
    expect(html).toContain('href="/font.woff2"');
    expect(html).toContain('as="font"');
    expect(html).toContain('type="font/woff2"');
    expect(html).toContain('crossorigin');
  });

  test('honors a custom type', async () => {
    const html = await container.renderToString(PreloadFont, { props: { url: '/font.woff', type: 'font/woff' } });

    expect(html).toMatch(/href="\/font\.woff"[^>]*type="font\/woff"/);
  });
});
