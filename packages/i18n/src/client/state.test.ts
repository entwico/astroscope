import { afterEach, describe, expect, test, vi } from 'vitest';
import type { I18nClientState } from '../shared/types';

const clientState: I18nClientState = {
  locale: 'en',
  hashes: {},
  translations: { greeting: 'Hello' },
  imports: {},
};

async function loadState(i18n: I18nClientState | undefined) {
  vi.resetModules();
  vi.stubGlobal('window', { __i18n__: i18n });

  return import('./state');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getI18nState', () => {
  test('returns the injected state', async () => {
    const { getI18nState } = await loadState(clientState);

    expect(getI18nState()).toBe(clientState);
  });

  test('does not log when state is present', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getI18nState } = await loadState(clientState);

    getI18nState();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('returns undefined and logs an error when state is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getI18nState } = await loadState(undefined);

    expect(getI18nState()).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('window.__i18n__ is not defined');
    expect(errorSpy.mock.calls[0]?.[0]).toContain('<I18nScript />');
  });

  test('logs the missing-state error only once', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getI18nState } = await loadState(undefined);

    getI18nState();
    getI18nState();
    getI18nState();

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
