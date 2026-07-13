import { afterEach, describe, expect, test, vi } from 'vitest';
import type { I18nClientState } from '../../shared/types';

function createElement(componentUrl: string | null): HTMLElement & { getAttribute: ReturnType<typeof vi.fn> } {
  return { getAttribute: vi.fn(() => componentUrl) } as unknown as HTMLElement & {
    getAttribute: ReturnType<typeof vi.fn>;
  };
}

async function loadUtils(i18n: I18nClientState | undefined) {
  vi.resetModules();
  vi.stubGlobal('window', { __i18n__: i18n });

  return import('./utils');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('warmUpI18nForChunk', () => {
  test('returns before touching i18n state when component-url is missing', async () => {
    vi.resetModules();

    const { warmUpI18nForChunk } = await import('./utils');
    const el = createElement(null);

    expect(() => warmUpI18nForChunk(el)).not.toThrow();
    expect(el.getAttribute).toHaveBeenCalledWith('component-url');
  });

  test('returns when i18n state is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { warmUpI18nForChunk } = await loadUtils(undefined);
    const el = createElement('/_astro/Cart.abc.js');

    expect(() => warmUpI18nForChunk(el)).not.toThrow();
  });

  test('does not prefetch when the chunk and its imports have no hashes', async () => {
    const { warmUpI18nForChunk } = await loadUtils({
      locale: 'en',
      hashes: {},
      translations: {},
      imports: { 'Cart.abc': ['Nested.def'] },
    });

    const el = createElement('/_astro/Cart.abc.js');

    expect(() => warmUpI18nForChunk(el)).not.toThrow();
  });

  test('prefetches the translation chunk for the component url', async () => {
    const loaded: string[] = [];

    vi.doMock('/_i18n/en/Cart.abc.h1.js', () => {
      loaded.push('Cart.abc');

      return {};
    });

    const { warmUpI18nForChunk } = await loadUtils({
      locale: 'en',
      hashes: { 'Cart.abc': 'h1' },
      translations: {},
      imports: {},
    });

    warmUpI18nForChunk(createElement('/_astro/Cart.abc.js'));

    await vi.waitFor(() => expect(loaded).toEqual(['Cart.abc']));
  });

  test('prefetches descendant chunks listed in the imports map', async () => {
    const loaded: string[] = [];

    vi.doMock('/_i18n/de/Page.aaa.h2.js', () => {
      loaded.push('Page.aaa');

      return {};
    });
    vi.doMock('/_i18n/de/Nested.bbb.h3.js', () => {
      loaded.push('Nested.bbb');

      return {};
    });

    const { warmUpI18nForChunk } = await loadUtils({
      locale: 'de',
      hashes: { 'Page.aaa': 'h2', 'Nested.bbb': 'h3', 'NoHash.ccc': '' },
      translations: {},
      imports: { 'Page.aaa': ['Nested.bbb', 'NoHash.ccc'] },
    });

    warmUpI18nForChunk(createElement('/_astro/Page.aaa.js'));

    await vi.waitFor(() => expect(loaded.sort()).toEqual(['Nested.bbb', 'Page.aaa']));
  });
});
