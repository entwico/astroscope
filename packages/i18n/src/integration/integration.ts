import type { AstroIntegration } from 'astro';
import { i18nVitePlugin } from '../extraction/vite-plugin.js';
import type { I18nOptions } from './types.js';

/**
 * Astro integration for i18n with automatic per-chunk translation loading.
 *
 * Registers the vite plugin for translation key extraction, chunk mapping and
 * loader injection, and injects both middlewares: the chunk middleware serving
 * `/_i18n/` translation chunks ahead of the project's own middleware, and the
 * locale middleware after it, so the locale resolver from `i18n.configure` sees
 * what a session middleware put on `locals`. Client state delivery and
 * translation preloading happen at runtime: the locale middleware bootstraps
 * `window.__i18n__`, and the islands emitter (via `@astroscope/node`) slices
 * hashes and preloads translation chunks per island — plain `client:*`
 * directives, no forks.
 */
export default function i18nIntegration(options: I18nOptions = {}): AstroIntegration {
  const { consistency = 'error', exclude = null } = options;

  return {
    name: '@astroscope/i18n',
    hooks: {
      'astro:config:setup': ({ addMiddleware, config, updateConfig, logger }) => {
        addMiddleware({ order: 'pre', entrypoint: '@astroscope/i18n/chunk-middleware' });
        addMiddleware({ order: 'post', entrypoint: '@astroscope/i18n/locale-middleware' });

        updateConfig({
          vite: {
            plugins: [i18nVitePlugin({ logger, consistency, exclude, base: config.base })],
          },
        });
      },
    },
  };
}
