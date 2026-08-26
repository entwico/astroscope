import type { AstroIntegration } from 'astro';
import { i18nVitePlugin } from '../extraction/vite-plugin.js';
import type { I18nOptions } from './types.js';

/**
 * Astro integration for i18n with automatic per-chunk translation loading.
 *
 * Registers the vite plugin for translation key extraction, chunk mapping and
 * loader injection, and injects the chunk middleware serving `/_i18n/`
 * translation chunks. Client state delivery and translation preloading happen at
 * runtime: the i18n middleware bootstraps `window.__i18n__`, and the islands
 * emitter (via `@astroscope/node`) slices hashes and preloads translation chunks
 * per island — plain `client:*` directives, no forks.
 */
export default function i18nIntegration(options: I18nOptions = {}): AstroIntegration {
  const { consistency = 'error' } = options;

  return {
    name: '@astroscope/i18n',
    hooks: {
      'astro:config:setup': ({ addMiddleware, updateConfig, logger }) => {
        addMiddleware({ order: 'pre', entrypoint: '@astroscope/i18n/chunk-middleware' });

        updateConfig({
          vite: {
            plugins: [i18nVitePlugin({ logger, consistency })],
          },
        });
      },
    },
  };
}
