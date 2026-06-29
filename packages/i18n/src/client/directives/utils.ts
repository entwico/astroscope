import type { I18nClientState } from '../../shared/types.js';
import { buildI18nChunkUrl, componentUrlToChunkName } from '../../shared/url.js';
import { getI18nState } from '../state.js';

/**
 * Prefetch translation chunk (fire and forget)
 */
function prefetchTranslation(chunkName: string, i18n: I18nClientState): void {
  const hash = i18n.hashes[chunkName];

  if (hash) {
    const url = buildI18nChunkUrl(i18n.locale, chunkName, hash);
    import(/* @vite-ignore */ url);
  }
}

/**
 * Warm up translation cache for a chunk and all its descendants (fire and forget)
 * Extracts chunk name from astro-island's component-url attribute
 * Uses flattened imports map from window.__i18n__ to prefetch all nested translations
 */
export function warmUpI18nForChunk(el: HTMLElement): void {
  const componentUrl = el.getAttribute('component-url');

  if (!componentUrl) return;

  const i18n = getI18nState();

  if (!i18n) return;

  const chunkName = componentUrlToChunkName(componentUrl);

  // prefetch this chunk's translations
  prefetchTranslation(chunkName, i18n);

  // prefetch all descendant translations (flattened in imports map)
  const deps = i18n.imports[chunkName] ?? [];

  for (const dep of deps) {
    prefetchTranslation(dep, i18n);
  }
}
