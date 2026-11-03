import { on } from '@astroscope/node/events';
import { shouldExclude } from '@astroscope/node/excludes';
import { log } from '@astroscope/node/log';
import type { RelayServerConfig, ServerConsent, ServerEventMeta, ServerReceipt } from '../runtime.js';
import { type ConsentRecord, type TrackFunction, eventIdOf, payloadOf, toTracked, unusableEventId } from '../shared.js';
import { getServerConfig } from './config.js';
import { type RelayRequestContext, getRelayContext } from './context.js';

// the destinations as the reporter holds them: the payload type is the destination's business
type Registered = {
  name: string;
  send(payload: unknown, meta: ServerEventMeta): ServerReceipt | Promise<ServerReceipt>;
};

// how long a shutdown waits for the reports still in flight; the conversions apis time out sooner
const DRAIN_TIMEOUT_MS = 10_000;

const pending = new Set<Promise<void>>();
let drainsOnShutdown = false;

/**
 * Reports an event to every consented server destination it carries a payload for, in the
 * background: a failure is logged and never fails the request. The reports still in flight are
 * awaited at shutdown, bounded, so a deploy never loses them. Returns the event id the browser
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

  // a prerendered page is rendered at build time, with no visitor to report
  if (context.context.isPrerendered) {
    log.debug({ key, id }, 'tracked while prerendering, nothing reported');

    return id;
  }

  const config = getServerConfig();

  if (shouldExclude(context.context, config.exclude)) {
    return id;
  }

  const meta: ServerEventMeta = { id, at: Date.now(), key, request: requestOf(context) };
  const registered = registeredDestinations(config.destinations);

  if (registered.length === 0) {
    log.debug({ key, id }, 'no server destination registered, nothing reported');

    return id;
  }

  const destinations = registered.filter((destination) =>
    consentOf(destination.name, config.consent, context.consent));

  // the record the request carried next to the names it was checked against: what to compare when nothing goes out
  if (destinations.length === 0) {
    const destinationNames = registered.map((destination) => destination.name);

    log.debug({ key, id, consent: context.consent, destinations: destinationNames }, 'no consented server destination, nothing reported');

    return id;
  }

  for (const destination of destinations) {
    const payload = payloadOf(event, destination.name);

    if (payload !== undefined) {
      remember(report(destination, payload, meta));
    }
  }

  return id;
};

/** the destinations under their own names; one under another key is logged and left out, as the browser refuses it */
function registeredDestinations(destinations: RelayServerConfig['destinations']): Registered[] {
  const registered: Registered[] = [];

  for (const [name, destination] of Object.entries(destinations) as [string, Registered | undefined][]) {
    if (!destination) continue;

    if (destination.name !== name) {
      log.error(
        { destination: destination.name, name },
        `relay: destination ${destination.name} is registered under ${name}`,
      );

      continue;
    }

    registered.push(destination);
  }

  return registered;
}

function consentOf(name: string, rules: ServerConsent<string> | undefined, consent: ConsentRecord): boolean {
  const rule = rules && Object.hasOwn(rules, name) ? rules[name] : undefined;

  if (rule === false) return true;
  if (typeof rule === 'function') return rule(consent);

  return consent[name] === true;
}

function requestOf({ context }: RelayRequestContext): ServerEventMeta['request'] {
  return {
    // astro throws for an adapter without one, which must not fail the request
    get clientAddress() {
      try {
        return context.clientAddress;
      } catch {
        return;
      }
    },
    headers: context.request.headers,
    cookie: (name) => context.cookies.get(name)?.value,
    sourceUrl: context.request.headers.get('referer') ?? context.url.origin,
  };
}

function remember(report: Promise<void>): void {
  if (!drainsOnShutdown) {
    drainsOnShutdown = true;
    on('beforeOnShutdown', drainReports);
  }

  pending.add(report);
  void report.finally(() => pending.delete(report));
}

/** waits for the reports in flight; a hung destination must not hold the shutdown */
async function drainReports(): Promise<void> {
  if (pending.size === 0) {
    return;
  }

  log.info({ pending: pending.size }, 'waiting for conversion reports');

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), DRAIN_TIMEOUT_MS);
  });
  const outcome = await Promise.race([Promise.all(pending), timeout]);

  clearTimeout(timer);

  if (outcome === 'timeout') {
    log.error({ pending: pending.size }, 'conversion reports still in flight at shutdown');
  }
}

async function report(destination: Registered, payload: unknown, meta: ServerEventMeta): Promise<void> {
  try {
    const receipt = await destination.send(payload, meta);

    log.debug({ ...receipt, destination: destination.name, key: meta.key, id: meta.id }, 'conversion reported');
  } catch (error) {
    log.error({ err: error, destination: destination.name, key: meta.key, id: meta.id }, 'failed to report conversion');
  }
}
