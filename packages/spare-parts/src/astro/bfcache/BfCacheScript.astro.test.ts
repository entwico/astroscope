import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

import BfCacheScript from './BfCacheScript.astro';

const scriptBody = (html: string) => html.match(/<script[^>]*>(.*)<\/script>/s)?.[1] ?? '';

describe('BfCacheScript', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  test('renders the pageshow reload + pagehide guard', async () => {
    const html = await container.renderToString(BfCacheScript);

    expect(html).toContain('pageshow');
    expect(html).toContain('persisted');
    expect(html).toContain('pagehide');
  });

  test('ships no comments in the inline script', async () => {
    const html = await container.renderToString(BfCacheScript);

    expect(scriptBody(html)).not.toContain('//');
  });
});
