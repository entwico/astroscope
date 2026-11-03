import { describe, expect, test, vi } from 'vitest';
import { compileTranslations } from '../shared/compiler';
import type { FallbackBehavior, I18nContext } from './types';

vi.mock('virtual:@astroscope/i18n/manifest', () => ({
  getManifest: () => ({ keys: [], chunks: {}, imports: {} }),
}));

const { missingAdd, logDebug, logError } = vi.hoisted(() => ({
  missingAdd: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@astroscope/node/telemetry', () => ({
  createCounter: () => ({ add: missingAdd }),
  createObservableGauge: () => {},
}));

vi.mock('@astroscope/node/log', () => ({ log: { debug: logDebug, error: logError } }));

async function createTranslate() {
  vi.resetModules();

  const { i18n } = await import('./i18n');
  const { getLocale, rich, t } = await import('./translate');
  const { runWithContext } = await import('./context');

  await i18n.configure({ locales: ['en', 'de'] });

  return { getLocale, rich, runWithContext, t };
}

const createI18nContext = (
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

    runWithContext(createI18nContext('de', {}), () => {
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

    runWithContext(createI18nContext('de', { greeting: 'Hallo {$name}' }), () => {
      expect(t('greeting', 'Hello {$name}', { name: 'Welt' })).toBe('Hallo Welt');
    });
  });

  test('prefers the translation over the fallback', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createI18nContext('en', { greeting: 'Hi' }), () => {
      expect(t('greeting', 'Hello')).toBe('Hi');
    });
  });

  test('uses the meta fallback when the translation is missing', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createI18nContext('en', {}), () => {
      expect(t('missing', 'Hello {$name}', { name: 'World' })).toBe('Hello World');
    });
  });

  test('caches the compiled fallback in the context', async () => {
    const { runWithContext, t } = await createTranslate();
    const context = createI18nContext('en', {});

    runWithContext(context, () => {
      t('missing', 'Hello');
    });

    expect(context.translations['missing']?.()).toBe('Hello');
  });

  test('falls back to the key when meta has no fallback', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createI18nContext('en', {}), () => {
      expect(t('missing.key', '')).toBe('missing.key');
    });
  });

  test('fallback behavior key returns the key even with a fallback given', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createI18nContext('en', {}, 'key'), () => {
      expect(t('missing.key', 'Hello')).toBe('missing.key');
    });
  });

  test('fallback behavior throw raises for missing translations', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createI18nContext('en', {}, 'throw'), () => {
      expect(() => t('missing.key', 'Hello')).toThrow('Missing translation for key: missing.key');
    });
  });

  test('fallback behavior function receives key and meta', async () => {
    const { runWithContext, t } = await createTranslate();
    const fallback = vi.fn((key: string) => `[${key}]`);

    runWithContext(createI18nContext('en', {}, fallback), () => {
      expect(t('missing.key', 'Hello')).toBe('[missing.key]');
    });

    expect(fallback).toHaveBeenCalledWith('missing.key', { fallback: 'Hello' });
  });

  test('treats an empty translation as missing', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createI18nContext('de', { greeting: '' }), () => {
      expect(t('greeting', 'Hello')).toBe('Hello');
      expect(missingAdd).toHaveBeenCalledWith(1, { 'astro.i18n.locale': 'de' });
    });
  });

  test('a message that fails to format renders the best effort and logs once per locale, key and message', async () => {
    const { i18n } = await import('./i18n');
    const { runWithContext, rich, t } = await createTranslate();

    const raw = { hello: 'Hallo {$name}', bye: 'Tschüss {$name}' };

    i18n.setTranslations('de', raw);

    runWithContext({ ...createI18nContext('de', raw), translations: i18n.getCompiledTranslations('de') }, () => {
      expect(t('hello', 'Hello')).toBe('Hallo {$name}');
      expect(t('hello', 'Hello')).toBe('Hallo {$name}');
      expect(rich('bye', 'Bye')).toEqual(['Tschüss ']);
      expect(rich('bye', 'Bye')).toEqual(['Tschüss ']);
    });

    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError.mock.calls.map(([fields]) => fields.key)).toEqual(['hello', 'bye']);
    expect(logError.mock.calls[0]?.[1]).toBe('translation failed to format');
  });

  test('falls back for keys named like Object.prototype members', async () => {
    const { runWithContext, t } = await createTranslate();

    runWithContext(createI18nContext('en', {}), () => {
      expect(t('constructor', 'Builder')).toBe('Builder');
      expect(t('toString', 'Text')).toBe('Text');
    });
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

    runWithContext(createI18nContext('de', { tos: 'Lies die {#link}AGB{/link}' }), () => {
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

    runWithContext(createI18nContext('de', { tos: '' }), () => {
      expect(rich('tos', 'Read our terms')).toEqual(['Read our terms']);
    });
  });
});

describe('missing translations', () => {
  test('a t() lookup that falls back is counted per locale and logged with its key', async () => {
    const { runWithContext, t } = await createTranslate();

    missingAdd.mockClear();
    logDebug.mockClear();

    runWithContext(createI18nContext('de', { present: 'Da' }), () => {
      expect(t('present', 'Here')).toBe('Da');
      expect(t('absent', 'Gone')).toBe('Gone');
    });

    expect(missingAdd).toHaveBeenCalledTimes(1);
    expect(missingAdd).toHaveBeenCalledWith(1, { 'astro.i18n.locale': 'de' });
    expect(logDebug).toHaveBeenCalledWith({ key: 'absent', locale: 'de' }, 'missing translation');
  });

  test('a rich() lookup that falls back is counted too', async () => {
    const { rich, runWithContext } = await createTranslate();

    missingAdd.mockClear();

    runWithContext(createI18nContext('en', {}), () => {
      expect(rich('absent', 'Gone')).toEqual(['Gone']);
    });

    expect(missingAdd).toHaveBeenCalledWith(1, { 'astro.i18n.locale': 'en' });
  });

  test('nothing is counted outside a request context', async () => {
    const { t } = await createTranslate();

    missingAdd.mockClear();

    expect(t('absent', 'Gone')).toBe('Gone');
    expect(missingAdd).not.toHaveBeenCalled();
  });
});
