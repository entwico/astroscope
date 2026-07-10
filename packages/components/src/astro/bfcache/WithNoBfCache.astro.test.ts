import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

import WithNoBfCache from './WithNoBfCache.astro';

describe('WithNoBfCache', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  test('sets the no-store Cache-Control header', async () => {
    const res = await container.renderToResponse(WithNoBfCache, { slots: { default: '<p>content</p>' } });

    expect(res.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  });

  test('renders the wrapped slot and the bfcache guard script', async () => {
    const html = await container.renderToString(WithNoBfCache, { slots: { default: '<p>content</p>' } });

    expect(html).toContain('<p>content</p>');
    expect(html).toContain('pageshow');
    expect(html).toContain('pagehide');
  });
});
