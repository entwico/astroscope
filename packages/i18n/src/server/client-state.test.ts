import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ExtractionManifest } from '../extraction/types';

const mocks = vi.hoisted(() => ({
  manifest: { keys: [], chunks: {}, scripts: [] } as ExtractionManifest,
}));

vi.mock('virtual:@astroscope/i18n/manifest', () => ({
  getManifest: () => mocks.manifest,
}));

async function setup(manifest?: Partial<ExtractionManifest>) {
  mocks.manifest = { keys: [], chunks: {}, scripts: [], ...manifest };

  vi.resetModules();

  const { i18n } = await import('./i18n');
  const { createFullStateScript, createScriptHashesScript } = await import('./client-state');

  await i18n.configure({ locales: ['en', 'de'] });

  return { i18n, createFullStateScript, createScriptHashesScript };
}

beforeEach(() => {
  mocks.manifest = { keys: [], chunks: {}, scripts: [] };
});

describe('createFullStateScript', () => {
  test('carries the full translations for the locale', async () => {
    const { i18n, createFullStateScript } = await setup();

    i18n.setTranslations('en', { greeting: 'Hello' });

    const script = createFullStateScript('en');

    expect(script).toContain('window.__i18n__');
    expect(script).toContain('"greeting":"Hello"');
  });

  test('escapes closing tags inside translation values', async () => {
    const { i18n, createFullStateScript } = await setup();

    i18n.setTranslations('en', { evil: 'a</script><script>alert(1)' });

    const script = createFullStateScript('en');

    expect(script).not.toContain('a</script>');
    expect(script).toContain('\\u003c/script');
  });
});

describe('createScriptHashesScript', () => {
  test('carries script-chunk hashes only', async () => {
    const { i18n, createScriptHashesScript } = await setup({
      chunks: { 'Cart.Cabc': ['cart.title'], 'hoisted.Cdef': ['banner.text'] },
      scripts: ['hoisted.Cdef'],
    });

    i18n.setTranslations('en', { 'cart.title': 'Cart', 'banner.text': 'Hi' });

    const script = createScriptHashesScript('en');

    expect(script).toContain('hoisted.Cdef');
    // island chunk hashes ride the emitter, not the bootstrap
    expect(script).not.toContain('Cart.Cabc');
    expect(script).not.toContain('"banner.text"');
  });

  test('returns null when no script chunk has translations', async () => {
    const { i18n, createScriptHashesScript } = await setup({ chunks: { 'Cart.Cabc': ['cart.title'] } });

    i18n.setTranslations('en', { 'cart.title': 'Cart' });

    expect(createScriptHashesScript('en')).toBeNull();
  });
});
