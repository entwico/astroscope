import { i18n } from './i18n.js';

/**
 * Scripts bootstrapping `window.__i18n__` on html responses, delivered through the
 * `@astroscope/node` document emitter (see islands-emitter.ts for the placement
 * policy). Both writers merge orderlessly (`??=` + assign), so emitter scripts and
 * the bootstrap can arrive in either order.
 */

/** translation values may contain `</script>` — escape `<` so they cannot end the tag */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** the full dev-mode state: every translation for the locale */
export function createFullStateScript(locale: string): string {
  const translations = i18n.getTranslations(locale);
  const state = jsonForScript({ locale, hashes: {}, translations });

  return `<script>window.__i18n__=Object.assign(window.__i18n__??{hashes:{},translations:{}},${state});</script>`;
}

/** the prod bootstrap: chunk hashes for astro `<script>` entry consumers */
export function createScriptHashesScript(locale: string): string | null {
  const hashes = i18n.getScriptChunkHashes(locale);

  if (Object.keys(hashes).length === 0) {
    return null;
  }

  const init = jsonForScript({ locale, hashes: {}, translations: {} });

  return `<script>{const i=window.__i18n__??=${init};Object.assign(i.hashes,${jsonForScript(hashes)});}</script>`;
}
