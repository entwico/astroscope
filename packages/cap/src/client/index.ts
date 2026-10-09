import capWasmUrl from '@cap.js/wasm/browser/cap_wasm_bg.wasm?url';
import hashwxWasmUrl from '@cap.js/wasm/browser/hashwx.wasm?url';
import type { Cap } from 'cap-widget';
import pakoUrl from 'pako/browser/inflate?url';
import { path } from 'virtual:@astroscope/cap/config';

declare global {
  interface Window {
    CAP_DISABLE_WIDGET_REF?: boolean | undefined;
  }
}

export { CAP_FIELD_NAME } from '../shared.js';

/** the proxy prefix, for `data-cap-api-endpoint` on a hand-written `<cap-widget>` */
export const CAP_API_ENDPOINT = path;

// a prepared token is used only this long after solving — well inside cap's own expiry, so the
// request that carries it never meets a token that expired on the way
const PREPARED_TOKEN_LIFETIME_MS = 5 * 60_000;

let registered: Promise<void> | undefined;

/**
 * Loads the cap client once and resolves when `<cap-widget>` is defined. Any hand-written widget
 * needs this before it can solve. Everything the client would fetch from a cdn — the two wasm
 * solvers and the pako fallback for browsers without `DecompressionStream` — comes from this
 * origin instead, and the visible widget's credits link stops reporting the page url and referrer
 * to the vendor on click.
 */
export function registerCapWidget(): Promise<void> {
  registered ??= (async () => {
    /* eslint-disable unicorn/no-global-object-property-assignment -- the cap widget reads its `window.CAP_*` globals on load, assigning them is its documented configuration mechanism */
    window.CAP_CUSTOM_WASM_URL = capWasmUrl;
    window.CAP_CUSTOM_HASHWX_URL = hashwxWasmUrl;
    window.CAP_PAKO_URL = pakoUrl;
    window.CAP_DISABLE_WIDGET_REF = true;
    /* eslint-enable unicorn/no-global-object-property-assignment */

    await import('cap-widget');
    await customElements.whenDefined('cap-widget');
  })();

  return registered;
}

// the cap client appends its hidden widget to the document and never removes it, so one instance
// serves every headless solve of the page
let headless: Cap | undefined;

/**
 * Solves a cap challenge without a widget — the proof of work runs in workers against the site's
 * own proxy. Resolves with the token for the `_cap` field, or `null` when solving failed. Client
 * only: call it from an event handler, never during render.
 */
export async function solveCap(): Promise<string | null> {
  try {
    await registerCapWidget();

    headless ??= new window.Cap({ apiEndpoint: path });

    const result = await headless.solve();

    return result?.success && result.token ? result.token : null;
  } catch {
    return null;
  }
}

export type CapSession = {
  /** start solving in the background unless a usable token is already prepared or on its way */
  prepare: () => void;
  /**
   * The token for the request that follows, solving if nothing usable is prepared. Resolves `null`
   * when solving failed. Each token is handed out once: the next `ensure()` solves anew.
   */
  ensure: () => Promise<string | null>;
};

/**
 * One form's captcha: `prepare()` on the first interaction hides the solving time behind the
 * typing, `ensure()` before every protected request.
 */
export function createCapSession(solve: () => Promise<string | null> = solveCap): CapSession {
  let pending: Promise<string | null> | null = null;
  let prepared: { token: string; solvedAt: number } | null = null;

  const usable = () => prepared !== null && Date.now() - prepared.solvedAt < PREPARED_TOKEN_LIFETIME_MS;

  const solveAndKeep = async (): Promise<string | null> => {
    try {
      const token = await solve();

      prepared = token === null ? null : { token, solvedAt: Date.now() };

      return token;
    } finally {
      pending = null;
    }
  };

  const start = (): Promise<string | null> => {
    pending ??= solveAndKeep();

    return pending;
  };

  return {
    prepare() {
      if (!pending && !usable()) {
        void start();
      }
    },

    async ensure() {
      if (pending) await pending;

      if (!usable()) await start();

      if (!prepared || !usable()) return null;

      const { token } = prepared;

      prepared = null;

      return token;
    },
  };
}
