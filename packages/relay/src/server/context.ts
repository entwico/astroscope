import { AsyncLocalStorage } from 'node:async_hooks';
import type { APIContext } from 'astro';
import type { ConsentRecord } from '../shared.js';

/** what the middleware knows about the request `track()` is called in */
export type RelayRequestContext = {
  /** the consent the browser sent, by destination name */
  consent: ConsentRecord;
  context: APIContext;
};

// keyed on globalThis like the config: the middleware and a `track()` call may come from separate
// module instances of this package, and the store must be the one the middleware wrote to
const CONTEXT_KEY = Symbol.for('@astroscope/relay.context');

type ContextHolder = { [CONTEXT_KEY]?: AsyncLocalStorage<RelayRequestContext> | undefined };

function storage(): AsyncLocalStorage<RelayRequestContext> {
  const holder = globalThis as ContextHolder;

  holder[CONTEXT_KEY] ??= new AsyncLocalStorage<RelayRequestContext>();

  return holder[CONTEXT_KEY];
}

/** runs the rest of the request inside the relay context; the middleware's business */
export function runWithRelayContext<T>(context: RelayRequestContext, fn: () => T): T {
  return storage().run(context, fn);
}

/** the context of the current request, `undefined` outside one (a build, a cron, a startup hook) */
export function getRelayContext(): RelayRequestContext | undefined {
  return storage().getStore();
}

/**
 * The consent the current request carries, by destination name: what a server destination's default
 * `consent` reads, and what a custom one reads to share another destination's flag. Empty outside a
 * request and for a request the browser sent nothing with.
 */
export function relayConsent(): ConsentRecord {
  return getRelayContext()?.consent ?? {};
}
