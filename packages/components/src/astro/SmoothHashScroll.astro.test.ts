import { runInNewContext } from 'node:vm';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

import SmoothHashScroll from './SmoothHashScroll.astro';

type ClickHandler = (event: Record<string, unknown>) => void;

interface AnchorOptions {
  target?: string | undefined;
  download?: boolean | undefined;
}

// runs the inline script against a minimal stand-in for the dom it touches
function install(script: string, { url, withBody = true }: { url: string; withBody?: boolean }) {
  const location = new URL(url);
  let handler: ClickHandler | undefined;
  const scrollIntoView = vi.fn();
  const pushState = vi.fn();
  const document = {
    body: withBody ? {} : null,
    addEventListener: (_type: string, fn: ClickHandler) => (handler = fn),
    getElementById: (id: string) => (id === 'x' ? { scrollIntoView } : null),
  };
  const window = { location, history: { pushState } };

  runInNewContext(script, { window, document, URL });

  const click = (href: string, { target = '', download = false }: AnchorOptions = {}) => {
    const preventDefault = vi.fn();
    const anchor = {
      tagName: 'A',
      href: new URL(href, location).href,
      target,
      hasAttribute: (name: string) => name === 'download' && download,
      parentNode: null,
    };
    const text = { tagName: undefined, parentNode: anchor };

    handler?.({ target: text, button: 0, defaultPrevented: false, preventDefault });

    return preventDefault;
  };

  return { click, scrollIntoView, pushState };
}

const inlineScript = (html: string) => html.match(/<script>(.*)<\/script>/s)?.[1] ?? '';

describe('SmoothHashScroll', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;
  let script: string;

  beforeAll(async () => {
    container = await AstroContainer.create();
    script = inlineScript(await container.renderToString(SmoothHashScroll));
  });

  test('renders a delegated smooth-scroll click handler', async () => {
    const html = await container.renderToString(SmoothHashScroll);

    expect(html).toContain('addEventListener');
    expect(html).toContain('scrollIntoView({ behavior: \'smooth\' })');
  });

  test('ships no comments in the inline script', () => {
    expect(script).not.toContain('//');
  });

  test('ignores modifier-key and non-primary clicks', async () => {
    const html = await container.renderToString(SmoothHashScroll);

    expect(html).toContain('event.metaKey');
    expect(html).toContain('event.ctrlKey');
    expect(html).toContain('event.shiftKey');
    expect(html).toContain('event.altKey');
    expect(html).toContain('event.button !== 0');
  });

  test('resolves targets by id like native navigation', async () => {
    const html = await container.renderToString(SmoothHashScroll);

    expect(html).toContain('document.getElementById');
    expect(html).toContain('decodeURIComponent');
  });

  test('smooth-scrolls a same-document hash link and updates the url hash', () => {
    const { click, scrollIntoView, pushState } = install(script, { url: 'https://site.test/page' });

    expect(click('#x')).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
    expect(pushState).toHaveBeenCalledWith(null, '', '#x');
  });

  test('keeps the current query when the link carries it', () => {
    const { click } = install(script, { url: 'https://site.test/page?tab=2' });

    expect(click('#x')).toHaveBeenCalled();
  });

  test('leaves a hash link to the same path without the current query to the browser', () => {
    const { click } = install(script, { url: 'https://site.test/page?tab=2' });

    expect(click('/page#x')).not.toHaveBeenCalled();
  });

  test('leaves a hash link to another path to the browser', () => {
    const { click } = install(script, { url: 'https://site.test/page' });

    expect(click('/other#x')).not.toHaveBeenCalled();
  });

  test('leaves a link without a matching target to the browser', () => {
    const { click } = install(script, { url: 'https://site.test/page' });

    expect(click('#missing')).not.toHaveBeenCalled();
  });

  test('leaves links that open elsewhere to the browser', () => {
    const { click } = install(script, { url: 'https://site.test/page' });

    expect(click('#x', { target: '_blank' })).not.toHaveBeenCalled();
    expect(click('#x', { download: true })).not.toHaveBeenCalled();
    expect(click('#x', { target: '_self' })).toHaveBeenCalled();
  });

  test('installs when included in the document head', () => {
    expect(() => install(script, { url: 'https://site.test/page', withBody: false })).not.toThrow();
  });
});
