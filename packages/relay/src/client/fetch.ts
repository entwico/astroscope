import { type ConsentRecord, RELAY_CONSENT_HEADER, serializeConsent } from '../shared.js';

const PATCHED = Symbol.for('@astroscope/relay.fetch');

type Fetch = typeof fetch & { [PATCHED]?: true };

/**
 * Wraps the global `fetch` so every same-origin request carries the consent header, read from the
 * bus at call time: the browser's half of the server-side `track()`. Astro's action client calls
 * `fetch` with no way to add a header per call, which is why the global is wrapped, once; the
 * original is kept and called, so other wrappers chain. Cross-origin requests are left alone — a
 * custom header would be a preflight there and tell a third party what the visitor chose.
 */
export function installConsentHeader(consent: () => ConsentRecord): void {
  const target = globalThis as { fetch?: Fetch };
  const original = target.fetch;

  if (typeof original !== 'function' || Object.hasOwn(original, PATCHED)) return;

  const patched: Fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const value = serializeConsent(consent());

    if (!value || !isSameOrigin(input)) {
      return original.call(this, input, init);
    }

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

    headers.set(RELAY_CONSENT_HEADER, value);

    return original.call(this, input, { ...init, headers });
  };

  patched[PATCHED] = true;
  target.fetch = patched;
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  const { location } = globalThis;

  try {
    return new URL(urlOf(input), location.href).origin === location.origin;
  } catch {
    return false;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;

  return input instanceof URL ? input.href : input.url;
}
