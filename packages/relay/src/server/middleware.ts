import type { MiddlewareHandler } from 'astro';
import { RELAY_CONSENT_HEADER, parseConsent } from '../shared.js';
import { runWithRelayContext } from './context.js';

/**
 * Reads the consent header the browser attached and runs the rest of the chain inside the relay
 * context, so `track()` in an action, an endpoint or a page reports to the consented destinations.
 * Injected by the integration as `pre` middleware, before the project's own — not part of the
 * public API.
 *
 * @internal
 */
export function createRelayMiddleware(): MiddlewareHandler {
  return (ctx, next) => {
    const consent = parseConsent(ctx.request.headers.get(RELAY_CONSENT_HEADER));

    return runWithRelayContext({ consent, context: ctx }, next);
  };
}
