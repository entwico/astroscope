import type { I18nClientState } from '../shared/types.js';

declare global {
  interface Window {
    __i18n__?: I18nClientState | undefined;
  }
}
