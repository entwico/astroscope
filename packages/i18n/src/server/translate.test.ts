import { describe, expect, test, vi } from 'vitest';
import { compileTranslations } from '../shared/compiler';
import type { FallbackBehavior, I18nContext } from './types';

vi.mock('virtual:@astroscope/i18n/manifest', () => ({
  getManifest: () => ({ keys: [], chunks: {}, imports: {} }),
}));

async function createTranslate() {
  vi.resetModules();

  const { i18n } = await import('./i18n');
  const { getLocale, rich, t } = await import('./translate');
  const { runWithContext } = await import('./context');

  await i18n.configure({ locales: ['en', 'de'] });

  return { getLocale, rich, runWithContext, t };
}

const createContext = (
  locale: string,
  raw: Record<string, string>,
  fallback: FallbackBehavior = 'fallback',
): I18nContext => ({
  locale,
  translations: compileTranslations(locale, raw),
  rawTranslations: raw,
  fallback,
});

describe('getLocale', () => {
  test('returns the default locale outside of a request context', async () => {
    const { getLocale } = await createTranslate();

    expect(getLocale()).toBe('en');
  });

  test('returns the context locale inside a request', async () => {
    const { getLocale, runWithContext } = await createTranslate();

    runWithContext(createContext('de', {}), () => {
      expect(getLocale()).toBe('de');
    });
  });
});

describe('t outside request context', () => {
  test('formats the fallback with the default locale', async () => {
    const { t } = await createTranslate();

    expect(t('greeting', 'Hello {$name}', { name: 'World' })).toBe('Hello World');
  });

  test('returns the key when no fallback is given', async () => {
    const { t } = await createTranslate();

    expect(t('greeting.missing', '')).toBe('greeting.missing');
  });

  test('accepts a meta object', async () => {
    const { t } = await createTranslate();

    expect(t('greeting', { fallback: 'Hello' })).toBe('Hello');
  });
});

describe('t inside request context', () => {
  test('uses the translation from the context', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createContext('de', { greeting: 'Hallo {$name}' }), () => {
      expect(t('greeting', 'Hello {$name}', { name: 'Welt' })).toBe('Hallo Welt');
    });
  });

  test('prefers the translation over the fallback', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createContext('en', { greeting: 'Hi' }), () => {
      expect(t('greeting', 'Hello')).toBe('Hi');
    });
  });

  test('uses the meta fallback when the translation is missing', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createContext('en', {}), () => {
      expect(t('missing', 'Hello {$name}', { name: 'World' })).toBe('Hello World');
    });
  });

  test('caches the compiled fallback in the context', async () => {
    const { runWithContext, t } = await createTranslate();
    const context = createContext('en', {});

    runWithContext(context, () => {
      t('missing', 'Hello');
    });

    expect(context.translations['missing']?.()).toBe('Hello');
  });

  test('falls back to the key when meta has no fallback', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createContext('en', {}), () => {
      expect(t('missing.key', '')).toBe('missing.key');
    });
  });

  test('fallback behavior key returns the key even with a fallback given', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createContext('en', {}, 'key'), () => {
      expect(t('missing.key', 'Hello')).toBe('missing.key');
    });
  });

  test('fallback behavior throw raises for missing translations', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createContext('en', {}, 'throw'), () => {
      expect(() => t('missing.key', 'Hello')).toThrow('Missing translation for key: missing.key');
    });
  });

  test('fallback behavior function receives key and meta', async () => {
    const { runWithContext, t } = await createTranslate();
    const fallback = vi.fn((key: string) => `[${key}]`);

    runWithContext(createContext('en', {}, fallback), () => {
      expect(t('missing.key', 'Hello')).toBe('[missing.key]');
    });

    expect(fallback).toHaveBeenCalledWith('missing.key', { fallback: 'Hello' });
  });
});

describe('rich', () => {
  type Node = { tag: string; children: unknown[] };

  const tag =
    (name: string) =>
    (children: unknown[]): Node => ({ tag: name, children });

  test('wraps markup in the fallback with components', async () => {
    const { rich } = await createTranslate();

    const result = rich<Node>('tos', 'Read our {#link}Terms{/link}', { link: tag('a') });

    expect(result).toEqual(['Read our ', { tag: 'a', children: ['Terms'] }]);
  });

  test('prefers the raw translation from the context', async () => {
    const { rich, runWithContext } = await createTranslate();

    runWithContext(createContext('de', { tos: 'Lies die {#link}AGB{/link}' }), () => {
      const result = rich<Node>('tos', 'Read our {#link}Terms{/link}', { link: tag('a') });

      expect(result).toEqual(['Lies die ', { tag: 'a', children: ['AGB'] }]);
    });
  });

  test('interpolates values', async () => {
    const { rich } = await createTranslate();

    const result = rich<Node>('greeting', 'Hello {#b}{$name}{/b}', { b: tag('strong') }, { name: 'World' });

    expect(result).toEqual(['Hello ', { tag: 'strong', children: ['World'] }]);
  });

  test('flattens markup without a matching component', async () => {
    const { rich } = await createTranslate();

    expect(rich('tos', 'Read our {#link}Terms{/link}')).toEqual(['Read our ', 'Terms']);
  });

  test('returns plain text as a single-element array', async () => {
    const { rich } = await createTranslate();

    expect(rich('plain', 'Just text')).toEqual(['Just text']);
  });

  test('falls back to the key when no translation and no fallback exist', async () => {
    const { rich } = await createTranslate();

    expect(rich('some.key')).toEqual(['some.key']);
  });

  test('treats an empty raw translation as missing', async () => {
    const { rich, runWithContext } = await createTranslate();

    runWithContext(createContext('de', { tos: '' }), () => {
      expect(rich('tos', 'Read our terms')).toEqual(['Read our terms']);
    });
  });
});
