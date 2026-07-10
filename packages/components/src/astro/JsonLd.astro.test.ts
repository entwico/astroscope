import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

import JsonLd from './JsonLd.astro';

const scriptBody = (html: string) => html.match(/<script[^>]*>(.*)<\/script>/s)?.[1] ?? '';

describe('JsonLd', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  const render = (props: Record<string, unknown>) => container.renderToString(JsonLd, { props });

  test('renders an application/ld+json block', async () => {
    const html = await render({ content: { '@type': 'Organization', name: 'X' } });

    expect(html).toContain('<script type="application/ld+json">');
  });

  test('wraps a single thing in the schema.org envelope', async () => {
    const html = await render({ content: { '@type': 'Organization', name: 'X' } });

    expect(JSON.parse(scriptBody(html))).toEqual({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', name: 'X' }],
    });
  });

  test('flattens an array of things into @graph', async () => {
    const html = await render({ content: [{ '@type': 'A' }, { '@type': 'B' }] });

    expect(JSON.parse(scriptBody(html))['@graph']).toHaveLength(2);
  });

  test('escapes `<` in schema values', async () => {
    const html = await render({ content: { '@type': 'X', name: '</script>' } });

    expect(scriptBody(html)).not.toContain('<');
  });
});
