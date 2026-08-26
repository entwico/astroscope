import type { I18nClientState } from '../shared/types.js';
import './types.js';

let warnedMissingState = false;

/**
 * Read the client i18n state injected by the i18n middleware and islands emitter.
 *
 * Returns undefined and logs an actionable error (once) when the state was not
 * injected — without it window.__i18n__ is undefined and translations cannot load.
 */
export function getI18nState(): I18nClientState | undefined {
  const state = window.__i18n__;

  if (!state && !warnedMissingState) {
    warnedMissingState = true;

    console.error(
      '[@astroscope/i18n] window.__i18n__ is not defined — translations will not work on the client. ' +
        'Make sure createI18nMiddleware() runs for this page (it injects the state) and, for per-island ' +
        'hashes, that the site uses the @astroscope/node adapter.',
    );
  }

  return state;
}
