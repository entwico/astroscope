import { describe, expect, test } from 'vitest';
import { getContext, runWithContext } from './context';
import type { I18nContext } from './types';

const createContext = (locale: string): I18nContext => ({
  locale,
  translations: {},
  rawTranslations: {},
  fallback: 'fallback',
});

describe('getContext', () => {
  test('returns null outside of a context', () => {
    expect(getContext()).toBeNull();
  });
});

describe('runWithContext', () => {
  test('provides the context inside the callback', () => {
    const context = createContext('en');

    runWithContext(context, () => {
      expect(getContext()).toBe(context);
    });
  });

  test('returns the callback result', () => {
    expect(runWithContext(createContext('en'), () => 42)).toBe(42);
  });

  test('keeps the context across async boundaries', async () => {
    const context = createContext('en');

    await runWithContext(context, async () => {
      await Promise.resolve();

      expect(getContext()).toBe(context);
    });
  });

  test('supports nested contexts and restores the outer one', () => {
    const outer = createContext('en');
    const inner = createContext('de');

    runWithContext(outer, () => {
      runWithContext(inner, () => {
        expect(getContext()).toBe(inner);
      });

      expect(getContext()).toBe(outer);
    });
  });

  test('clears the context after the callback returns', () => {
    runWithContext(createContext('en'), () => {});

    expect(getContext()).toBeNull();
  });

  test('isolates contexts between concurrent async chains', async () => {
    const seen: string[] = [];

    const run = (locale: string) =>
      runWithContext(createContext(locale), async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));

        seen.push(getContext()?.locale ?? 'none');
      });

    await Promise.all([run('en'), run('de')]);

    expect(seen.sort()).toEqual(['de', 'en']);
  });
});
