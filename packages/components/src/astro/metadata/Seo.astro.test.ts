import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

import Seo from './Seo.astro';

describe('Seo', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  const render = (props: Record<string, unknown>, url = 'https://site.test/page') =>
    container.renderToString(Seo, { props, request: new Request(url) });

  test('renders title and description', async () => {
    const html = await render({ title: 'Hello', description: 'Desc' });

    expect(html).toContain('<title>Hello</title>');
    expect(html).toContain('<meta name="description" content="Desc">');
  });

  test('omits the robots tag on the permissive default', async () => {
    const html = await render({ title: 'Hello' });

    expect(html).not.toContain('name="robots"');
  });

  test('emits noindex/nofollow when restricted', async () => {
    const html = await render({ title: 'Hello', index: false, follow: false });

    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  test('appends unavailable_after as ISO on an indexable page', async () => {
    const html = await render({ title: 'Hello', unavailableAfter: '2030-01-01' });

    expect(html).toContain('content="unavailable_after: 2030-01-01T00:00:00.000Z"');
  });

  test('absolutizes a relative canonical against the request origin', async () => {
    const html = await render({ title: 'Hello', canonical: '/foo' }, 'https://site.test/page');

    expect(html).toContain('<link rel="canonical" href="https://site.test/foo">');
  });

  test('emits hreflang alternates when indexable', async () => {
    const html = await render({ title: 'Hello', alternates: [{ hreflang: 'de', href: 'https://x/de' }] });

    expect(html).toContain('<link rel="alternate" hreflang="de" href="https://x/de">');
  });

  test('suppresses canonical and hreflang on a noindex page', async () => {
    const html = await render({
      title: 'Hello',
      index: false,
      canonical: '/foo',
      alternates: [{ hreflang: 'en', href: 'https://x/en' }],
    });

    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('rel="alternate"');
  });
});
