import { afterEach, describe, expect, test, vi } from 'vitest';
import type { I18nClientState } from '../shared/types';

function createState(overrides?: Partial<I18nClientState>): I18nClientState {
  return {
    locale: 'en',
    hashes: {},
    translations: {},
    imports: {},
    ...overrides,
  };
}

async function loadTranslate(i18n: I18nClientState | undefined) {
  vi.resetModules();
  vi.stubGlobal('window', { __i18n__: i18n });

  return import('./translate');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getLocale', () => {
  test('returns the locale from state', async () => {
    const { getLocale } = await loadTranslate(createState({ locale: 'de' }));

    expect(getLocale()).toBe('de');
  });

  test('returns empty string when state is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { getLocale } = await loadTranslate(undefined);

    expect(getLocale()).toBe('');
  });
});

describe('t', () => {
  test('returns the loaded translation over the fallback', async () => {
    const { t } = await loadTranslate(createState({ translations: { greeting: 'Hallo' } }));

    expect(t('greeting', 'Hello')).toBe('Hallo');
  });

  test('interpolates variables in the translation', async () => {
    const { t } = await loadTranslate(createState({ translations: { greeting: 'Hello {$name}' } }));

    expect(t('greeting', '', { name: 'World' })).toBe('Hello World');
  });

  test('uses the string fallback when translation is missing', async () => {
    const { t } = await loadTranslate(createState());

    expect(t('missing', 'Fallback text')).toBe('Fallback text');
  });

  test('interpolates variables in the fallback', async () => {
    const { t } = await loadTranslate(createState());

    expect(t('missing', 'Hi {$name}', { name: 'World' })).toBe('Hi World');
  });

  test('uses the fallback from a meta object', async () => {
    const { t } = await loadTranslate(createState());

    expect(t('missing', { fallback: 'Meta fallback' })).toBe('Meta fallback');
  });

  test('returns the key when translation and fallback are missing', async () => {
    const { t } = await loadTranslate(createState());

    expect(t('missing.key', '')).toBe('missing.key');
  });

  test('returns the key for the production call pattern without meta', async () => {
    const module = await loadTranslate(createState());
    const t = module.t as unknown as (key: string) => string;

    expect(t('missing.key')).toBe('missing.key');
  });

  test('caches the compiled translation per key', async () => {
    const state = createState({ translations: { greeting: 'Hello' } });
    const { t } = await loadTranslate(state);

    expect(t('greeting', '')).toBe('Hello');

    state.translations['greeting'] = 'Changed';

    expect(t('greeting', '')).toBe('Hello');
  });

  test('falls back when window.__i18n__ is missing entirely', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { t } = await loadTranslate(undefined);

    expect(t('missing', 'Fallback')).toBe('Fallback');
    expect(t('missing.no.fallback', '')).toBe('missing.no.fallback');
  });
});

describe('rich', () => {
  type Node = { tag: string; children: unknown[] };

  const wrap =
    (tag: string) =>
    (children: (string | Node)[]): Node => ({ tag, children });

  test('wraps markup content with the matching component', async () => {
    const { rich } = await loadTranslate(createState({ translations: { tos: 'Read our {#link}Terms{/link}' } }));

    const result = rich<Node>('tos', undefined, { link: wrap('a') });

    expect(result).toEqual(['Read our ', { tag: 'a', children: ['Terms'] }]);
  });

  test('uses the fallback message when translation is missing', async () => {
    const { rich } = await loadTranslate(createState());

    const result = rich<Node>('missing', 'Hello {#b}World{/b}', { b: wrap('strong') });

    expect(result).toEqual(['Hello ', { tag: 'strong', children: ['World'] }]);
  });

  test('flattens markup without a matching component', async () => {
    const { rich } = await loadTranslate(createState());

    const result = rich('missing', 'Read our {#link}Terms{/link}');

    expect(result).toEqual(['Read our ', 'Terms']);
  });

  test('interpolates values', async () => {
    const { rich } = await loadTranslate(createState());

    const result = rich('missing', 'Hi {$name}', {}, { name: 'Bob' });

    expect(result.join('')).toBe('Hi Bob');
  });

  test('falls back to the key when no translation and no fallback exist', async () => {
    const { rich } = await loadTranslate(createState());

    expect(rich('some.key')).toEqual(['some.key']);
  });

  test('treats an empty translation as missing', async () => {
    const { rich } = await loadTranslate(createState({ translations: { tos: '' } }));

    expect(rich('tos', 'Read our terms')).toEqual(['Read our terms']);
  });
});
