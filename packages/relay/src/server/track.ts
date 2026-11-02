import { shouldExclude } from '@astroscope/node/excludes';
import { log } from '@astroscope/node/log';
import type { ServerConsent, ServerEventMeta } from '../runtime.js';
import { type ConsentRecord, type TrackFunction, eventIdOf, payloadOf, toTracked, unusableEventId } from '../shared.js';
import { getServerConfig } from './config.js';
import { type RelayRequestContext, getRelayContext } from './context.js';

// the destinations as the reporter holds them: the payload type is the destination's business
type Registered = {
  name: string;
  send(payload: unknown, meta: ServerEventMeta): void | Promise<void>;
};

/**
 * Reports an event to every consented server destination it carries a payload for, in the
 * background: a failure is logged and never fails the request. Returns the event id the browser
 * fires its pixels under: the event's own (an order number, so a resubmitted order never counts
 * twice) or a fresh one. Outside a request, for an excluded one, or without the browser's consent it
 * reports nothing and still returns the id.
 */
export const track: TrackFunction = (input) => {
  const { event, key, id: own } = toTracked(input);
  const id = eventIdOf(own);
  const unusable = unusableEventId(own, id);

  if (unusable) {
    log.error({ key, id }, unusable);
  }

  const context = getRelayContext();

  if (!context) {
    log.debug({ key, id }, 'tracked outside a request, nothing reported');

    return id;
  }

  const config = getServerConfig();

  if (shouldExclude(context.context, config.exclude)) {
    return id;
  }

  const meta: ServerEventMeta = { id, at: Date.now(), key, request: requestOf(context) };
  const registered = Object.values(config.destinations).filter((destination) => destination !== undefined) as
    Registered[];
  const destinations = registered.filter((destination) => consentOf(destination.name, config.consent, context.consent));

  if (destinations.length === 0) {
    log.debug({ key, id }, 'no consented server destination, nothing reported');

    return id;
  }

  for (const destination of destinations) {
    const payload = payloadOf(event, destination.name);

    if (payload !== undefined) {
      void report(destination, payload, meta);
    }
  }

  return id;
};

function consentOf(name: string, rules: ServerConsent<string> | undefined, consent: ConsentRecord): boolean {
  const rule = rules?.[name];

  if (rule === false) return true;
  if (typeof rule === 'function') return rule(consent);

  return consent[name] === true;
}

function requestOf({ context }: RelayRequestContext): ServerEventMeta['request'] {
  return {
    clientAddress: context.clientAddress,
    headers: context.request.headers,
    cookie: (name) => context.cookies.get(name)?.value,
    sourceUrl: context.request.headers.get('referer') ?? context.url.origin,
  };
}

async function report(destination: Registered, payload: unknown, meta: ServerEventMeta): Promise<void> {
  try {
    await destination.send(payload, meta);
    log.debug({ destination: destination.name, key: meta.key, id: meta.id }, 'conversion reported');
  } catch (error) {
    log.error({ error, destination: destination.name, key: meta.key, id: meta.id }, 'failed to report conversion');
  }
}
