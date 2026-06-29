import type { I18nClientState } from '../shared/types.js';
import './types.js';

let warnedMissingState = false;

/**
 * Read the client i18n state injected by <I18nScript />.
 *
 * Returns undefined and logs an actionable error (once) when the script was not
 * rendered — without it window.__i18n__ is undefined and translations cannot load.
 */
export function getI18nState(): I18nClientState | undefined {
  const state = window.__i18n__;

  if (!state && !warnedMissingState) {
    warnedMissingState = true;

    console.error(
      '[@astroscope/i18n] window.__i18n__ is not defined — translations will not work on the client. ' +
        'Render <I18nScript /> in your page <head> (before any hydrated islands) and make sure the i18n middleware is configured.',
    );
  }

  return state;
}
