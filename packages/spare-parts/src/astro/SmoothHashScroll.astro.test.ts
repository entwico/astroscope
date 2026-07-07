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

  test('ignores modifier-key and non-primary clicks', async () => {
    const html = await container.renderToString(SmoothHashScroll);

    expect(html).toContain('event.metaKey');
    expect(html).toContain('event.ctrlKey');
    expect(html).toContain('event.shiftKey');
    expect(html).toContain('event.altKey');
    expect(html).toContain('event.button !== 0');
  });

  test('updates the URL hash for deep-linking', async () => {
    const html = await container.renderToString(SmoothHashScroll);

    expect(html).toContain('history.pushState');
  });

  test('resolves targets by id like native navigation', async () => {
    const html = await container.renderToString(SmoothHashScroll);

    expect(html).toContain('document.getElementById');
    expect(html).toContain('decodeURIComponent');
  });
});
