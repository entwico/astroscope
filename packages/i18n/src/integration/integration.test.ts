import type { AstroIntegrationLogger } from 'astro';
import type { Plugin } from 'vite';
import { describe, expect, test, vi } from 'vitest';
import i18nIntegration from './integration.js';
import type { I18nOptions } from './types.js';

type SetupHook = (params: unknown) => void;
type LoadHook = (this: unknown, id: string) => string | undefined;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as AstroIntegrationLogger;

function setup(options?: I18nOptions, base = '/') {
  const addMiddleware = vi.fn();
  const updateConfig = vi.fn();
  const integration = i18nIntegration(options);

  (integration.hooks['astro:config:setup'] as unknown as SetupHook)({
    addMiddleware,
    updateConfig,
    logger,
    config: { base },
  });

  const plugins = (updateConfig.mock.calls[0]?.[0] as { vite: { plugins: Plugin[] } }).vite.plugins;

  return { addMiddleware, plugins };
}

async function loadConfigModule(plugin: Plugin | undefined) {
  const code = (plugin?.load as unknown as LoadHook).call({}, '\0virtual:@astroscope/i18n/config')!;

  return (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as { exclude: unknown; chunkPrefix: string };
}

describe('i18n integration', () => {
  test('serves chunks ahead of the project middleware and resolves the locale after it', () => {
    const { addMiddleware } = setup();

    expect(addMiddleware.mock.calls.map(([middleware]) => middleware)).toEqual([
      { order: 'pre', entrypoint: '@astroscope/i18n/chunk-middleware' },
      { order: 'post', entrypoint: '@astroscope/i18n/locale-middleware' },
    ]);
  });

  test('hands the exclude patterns and the site base to the middleware config', async () => {
    const { plugins } = setup({ exclude: [{ prefix: '/api/' }] }, '/docs/');

    expect(plugins).toHaveLength(1);
    expect(await loadConfigModule(plugins[0])).toMatchObject({
      exclude: [{ prefix: '/api/' }],
      chunkPrefix: '/docs/_i18n/',
    });
  });

  test('leaves the exclude patterns to the middleware default when none are given', async () => {
    const { plugins } = setup();

    expect(await loadConfigModule(plugins[0])).toMatchObject({ exclude: null, chunkPrefix: '/_i18n/' });
  });
});
