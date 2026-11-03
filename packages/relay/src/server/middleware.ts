import type { MiddlewareHandler } from 'astro';
import { RELAY_CONSENT_HEADER, parseConsent } from '../shared.js';
import { runWithRelayContext } from './context.js';

/**
 * Reads the consent header the browser attached and runs the rest of the chain inside the relay
 * context, so `track()` in an action, an endpoint or a page reports to the consented destinations.
 * Only the bus writes the header, onto `fetch`: a navigation carries none, and a page's frontmatter
 * then reports nothing (the README says so).
 * Injected by the integration as `pre` middleware, before the project's own — not part of the
 * public API.
 *
 * @internal
 */
export function createRelayMiddleware(): MiddlewareHandler {
  return (ctx, next) => {
    // a prerendered page has no visitor, and astro warns about every header read while rendering it
    const consent = ctx.isPrerendered ? {} : parseConsent(ctx.request.headers.get(RELAY_CONSENT_HEADER));

    return runWithRelayContext({ consent, context: ctx }, next);
  };
}
