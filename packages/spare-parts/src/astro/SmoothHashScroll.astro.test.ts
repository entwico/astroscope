import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

import SmoothHashScroll from './SmoothHashScroll.astro';

describe('SmoothHashScroll', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  test('renders a delegated smooth-scroll click handler', async () => {
    const html = await container.renderToString(SmoothHashScroll);

    expect(html).toContain('addEventListener');
    expect(html).toContain("scrollIntoView({ behavior: 'smooth' })");
  });
});
