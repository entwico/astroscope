import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getGlobalState } from '../extraction/manifest';
import type { ExtractionManifest } from '../extraction/types';

const mocks = vi.hoisted(() => ({
  manifest: { keys: [], chunks: {}, imports: {} } as {
    keys: { key: string; meta: { fallback: string }; files: string[] }[];
    chunks: Record<string, string[]>;
    imports: Record<string, string[]>;
  },
}));

vi.mock('virtual:@astroscope/i18n/manifest', () => ({
  getManifest: () => mocks.manifest,
}));

async function createI18n(manifest?: Partial<ExtractionManifest>) {
  mocks.manifest = { keys: [], chunks: {}, imports: {}, ...manifest };

  vi.resetModules();

  const { i18n } = await import('./i18n');

  return i18n;
}

async function createConfiguredI18n(manifest?: Partial<ExtractionManifest>) {
  const i18n = await createI18n(manifest);

  await i18n.configure({ locales: ['en', 'de'] });

  return i18n;
}

beforeEach(() => {
  mocks.manifest = { keys: [], chunks: {}, imports: {} };
});

describe('configure', () => {
  test('throws on empty locales array', async () => {
    const i18n = await createI18n();

    await expect(i18n.configure({ locales: [] })).rejects.toThrow('locales array is required');
  });

  test('throws on empty locale', async () => {
    const i18n = await createI18n();

    await expect(i18n.configure({ locales: ['en', ''] })).rejects.toThrow('locale cannot be empty');
  });

  test('throws on locale with whitespace', async () => {
    const i18n = await createI18n();

    await expect(i18n.configure({ locales: ['en '] })).rejects.toThrow('leading or trailing whitespace');
  });

  test('throws on duplicate locales', async () => {
    const i18n = await createI18n();

    await expect(i18n.configure({ locales: ['en', 'de', 'en'] })).rejects.toThrow('contains duplicates');
  });

  test('throws on empty defaultLocale', async () => {
    const i18n = await createI18n();

    await expect(i18n.configure({ locales: ['en'], defaultLocale: '' })).rejects.toThrow(
      'defaultLocale cannot be empty',
    );
  });

  test('throws on defaultLocale with whitespace', async () => {
    const i18n = await createI18n();

    await expect(i18n.configure({ locales: ['en'], defaultLocale: ' en' })).rejects.toThrow(
      'leading or trailing whitespace',
    );
  });

  test('throws when defaultLocale is not in locales', async () => {
    const i18n = await createI18n();

    await expect(i18n.configure({ locales: ['en'], defaultLocale: 'fr' })).rejects.toThrow('is not in locales array');
  });

  test('defaults defaultLocale to first locale and fallback behavior to fallback', async () => {
    const i18n = await createI18n();

    await i18n.configure({ locales: ['de', 'en'] });

    expect(i18n.getConfig()).toEqual({ locales: ['de', 'en'], defaultLocale: 'de', fallback: 'fallback' });
  });

  test('keeps explicit defaultLocale and fallback behavior', async () => {
    const i18n = await createI18n();

    await i18n.configure({ locales: ['de', 'en'], defaultLocale: 'en', fallback: 'throw' });

    expect(i18n.getConfig()).toEqual({ locales: ['de', 'en'], defaultLocale: 'en', fallback: 'throw' });
  });

  test('isConfigured reflects configuration state', async () => {
    const i18n = await createI18n();

    expect(i18n.isConfigured()).toBe(false);

    await i18n.configure({ locales: ['en'] });

    expect(i18n.isConfigured()).toBe(true);
  });

  test('getConfig throws before configure', async () => {
    const i18n = await createI18n();

    expect(() => i18n.getConfig()).toThrow('i18n not configured');
  });

  test('getManifest throws before configure', async () => {
    const i18n = await createI18n();

    expect(() => i18n.getManifest()).toThrow('manifest not initialized');
  });
});

describe('translations', () => {
  test('getTranslations returns empty object when nothing is set', async () => {
    const i18n = await createConfiguredI18n();

    expect(i18n.getTranslations('en')).toEqual({});
  });

  test('getTranslations returns raw translations when manifest has no keys', async () => {
    const i18n = await createConfiguredI18n();

    i18n.setTranslations('en', { greeting: 'Hello' });

    expect(i18n.getTranslations('en')).toEqual({ greeting: 'Hello' });
  });

  test('merges manifest fallbacks for keys without translations', async () => {
    const i18n = await createConfiguredI18n({
      keys: [
        { key: 'greeting', meta: { fallback: 'Hello' }, files: [] },
        { key: 'farewell', meta: { fallback: 'Bye' }, files: [] },
      ],
    });

    i18n.setTranslations('en', { greeting: 'Hi there' });

    expect(i18n.getTranslations('en')).toEqual({ greeting: 'Hi there', farewell: 'Bye' });
  });

  test('caches the merged result', async () => {
    const i18n = await createConfiguredI18n({
      keys: [{ key: 'greeting', meta: { fallback: 'Hello' }, files: [] }],
    });

    expect(i18n.getTranslations('en')).toBe(i18n.getTranslations('en'));
  });

  test('setTranslations invalidates the merged cache', async () => {
    const i18n = await createConfiguredI18n({
      keys: [{ key: 'greeting', meta: { fallback: 'Hello' }, files: [] }],
    });

    expect(i18n.getTranslations('en')).toEqual({ greeting: 'Hello' });

    i18n.setTranslations('en', { greeting: 'Hi' });

    expect(i18n.getTranslations('en')).toEqual({ greeting: 'Hi' });
  });

  test('keeps locales independent', async () => {
    const i18n = await createConfiguredI18n();

    i18n.setTranslations('en', { greeting: 'Hello' });
    i18n.setTranslations('de', { greeting: 'Hallo' });

    expect(i18n.getTranslations('en')).toEqual({ greeting: 'Hello' });
    expect(i18n.getTranslations('de')).toEqual({ greeting: 'Hallo' });
  });

  test('getCompiledTranslations compiles messages and caches per locale', async () => {
    const i18n = await createConfiguredI18n();

    i18n.setTranslations('en', { greeting: 'Hello {$name}' });

    const compiled = i18n.getCompiledTranslations('en');

    expect(compiled['greeting']?.({ name: 'World' })).toBe('Hello World');
    expect(i18n.getCompiledTranslations('en')).toBe(compiled);
  });
});

describe('getChunkBody', () => {
  const chunks = { 'Cart.Cabc': ['cart.title', 'cart.total'] };

  test('returns undefined for unknown chunks', async () => {
    const i18n = await createConfiguredI18n({ chunks });

    expect(i18n.getChunkBody('en', 'Nope.Cxyz')).toBeUndefined();
  });

  test('returns a script containing only the chunk translations', async () => {
    const i18n = await createConfiguredI18n({ chunks });

    i18n.setTranslations('en', { 'cart.title': 'Cart', 'other.key': 'Other' });

    const body = i18n.getChunkBody('en', 'Cart.Cabc');
    const js = new TextDecoder().decode(body);

    expect(js).toContain('{"cart.title":"Cart"}');
    expect(js).not.toContain('other.key');
  });

  test('caches the encoded body per locale and chunk', async () => {
    const i18n = await createConfiguredI18n({ chunks });

    i18n.setTranslations('en', { 'cart.title': 'Cart' });

    expect(i18n.getChunkBody('en', 'Cart.Cabc')).toBe(i18n.getChunkBody('en', 'Cart.Cabc'));
  });

  test('setTranslations invalidates the chunk cache for that locale', async () => {
    const i18n = await createConfiguredI18n({ chunks });

    i18n.setTranslations('en', { 'cart.title': 'Cart' });

    const before = i18n.getChunkBody('en', 'Cart.Cabc');

    i18n.setTranslations('en', { 'cart.title': 'Basket' });

    const after = new TextDecoder().decode(i18n.getChunkBody('en', 'Cart.Cabc'));

    expect(after).not.toBe(new TextDecoder().decode(before));
    expect(after).toContain('Basket');
  });

  test('includes manifest fallbacks for chunk keys', async () => {
    const i18n = await createConfiguredI18n({
      keys: [{ key: 'cart.title', meta: { fallback: 'Cart' }, files: [] }],
      chunks,
    });

    const js = new TextDecoder().decode(i18n.getChunkBody('en', 'Cart.Cabc'));

    expect(js).toContain('{"cart.title":"Cart"}');
  });
});

describe('getHashes', () => {
  test('returns empty object when no translations were set', async () => {
    const i18n = await createConfiguredI18n();

    expect(i18n.getHashes('en')).toEqual({});
  });

  test('computes hashes on setTranslations when chunks exist', async () => {
    const i18n = await createConfiguredI18n({ chunks: { 'Cart.Cabc': ['cart.title'] } });

    i18n.setTranslations('en', { 'cart.title': 'Cart' });

    const hashes = i18n.getHashes('en');

    expect(hashes['Cart.Cabc']).toMatch(/^[0-9a-f]{8}$/);
  });

  test('hash changes when translations change', async () => {
    const i18n = await createConfiguredI18n({ chunks: { 'Cart.Cabc': ['cart.title'] } });

    i18n.setTranslations('en', { 'cart.title': 'Cart' });

    const before = i18n.getHashes('en')['Cart.Cabc'];

    i18n.setTranslations('en', { 'cart.title': 'Basket' });

    expect(i18n.getHashes('en')['Cart.Cabc']).not.toBe(before);
  });

  test('does not compute hashes without chunks', async () => {
    const i18n = await createConfiguredI18n();

    i18n.setTranslations('en', { greeting: 'Hello' });

    expect(i18n.getHashes('en')).toEqual({});
  });
});

describe('getClientScript', () => {
  test('inlines all translations when there are no chunks', async () => {
    const i18n = await createConfiguredI18n();

    i18n.setTranslations('en', { greeting: 'Hello' });

    const script = i18n.getClientScript('en');

    expect(script).toContain('window.__i18n__=');
    expect(script).toContain('"greeting":"Hello"');
    expect(script).toContain('"locale":"en"');
  });

  test('emits hashes and imports instead of translations when chunks exist', async () => {
    const i18n = await createConfiguredI18n({
      chunks: { 'Cart.Cabc': ['cart.title'] },
      imports: { 'Page.Cdef': ['Cart.Cabc'] },
    });

    i18n.setTranslations('en', { 'cart.title': 'Cart' });

    const script = i18n.getClientScript('en');

    expect(script).toContain('window.__i18n__=');
    expect(script).toContain('"Cart.Cabc"');
    expect(script).toContain('translations:{}');
    expect(script).not.toContain('Cart"}');
  });

  test('caches the script per locale and invalidates on setTranslations', async () => {
    const i18n = await createConfiguredI18n();

    i18n.setTranslations('en', { greeting: 'Hello' });

    const first = i18n.getClientScript('en');

    expect(i18n.getClientScript('en')).toBe(first);

    i18n.setTranslations('en', { greeting: 'Hi' });

    expect(i18n.getClientScript('en')).toContain('"greeting":"Hi"');
  });
});

describe('clear', () => {
  test('clears a single locale', async () => {
    const i18n = await createConfiguredI18n();

    i18n.setTranslations('en', { greeting: 'Hello' });
    i18n.setTranslations('de', { greeting: 'Hallo' });

    i18n.clear('en');

    expect(i18n.getTranslations('en')).toEqual({});
    expect(i18n.getTranslations('de')).toEqual({ greeting: 'Hallo' });
  });

  test('clears all configured locales when called without arguments', async () => {
    const i18n = await createConfiguredI18n();

    i18n.setTranslations('en', { greeting: 'Hello' });
    i18n.setTranslations('de', { greeting: 'Hallo' });

    i18n.clear();

    expect(i18n.getTranslations('en')).toEqual({});
    expect(i18n.getTranslations('de')).toEqual({});
  });

  test('clears an array of locales', async () => {
    const i18n = await createConfiguredI18n();

    i18n.setTranslations('en', { greeting: 'Hello' });
    i18n.setTranslations('de', { greeting: 'Hallo' });

    i18n.clear(['en', 'de']);

    expect(i18n.getTranslations('en')).toEqual({});
    expect(i18n.getTranslations('de')).toEqual({});
  });

  test('cleared locale falls back to manifest fallbacks again', async () => {
    const i18n = await createConfiguredI18n({
      keys: [{ key: 'greeting', meta: { fallback: 'Hello' }, files: [] }],
    });

    i18n.setTranslations('en', { greeting: 'Hi' });
    i18n.clear('en');

    expect(i18n.getTranslations('en')).toEqual({ greeting: 'Hello' });
  });
});

describe('manifest invalidation', () => {
  test('derived caches are rebuilt when the global manifest version changes', async () => {
    const i18n = await createConfiguredI18n({
      keys: [{ key: 'greeting', meta: { fallback: 'Hello' }, files: [] }],
    });

    const before = i18n.getTranslations('en');

    mocks.manifest = {
      keys: [{ key: 'greeting', meta: { fallback: 'Hello v2' }, files: [] }],
      chunks: {},
      imports: {},
    };
    getGlobalState().version++;

    const after = i18n.getTranslations('en');

    expect(before).toEqual({ greeting: 'Hello' });
    expect(after).toEqual({ greeting: 'Hello v2' });
  });
});
