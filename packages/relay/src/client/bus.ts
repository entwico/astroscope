import {
  type ConsentAnswer,
  type ConsentRecord,
  type ConsentSource,
  type DestinationName,
  type EventMeta,
  type RelayDestinations,
  type RelayEvent,
  type TrackInput,
  eventIdOf,
  payloadOf,
  toTracked,
  unusableEventId,
} from '../shared.js';
import { type Outcome, reportLate, reportTracked } from './debug.js';

/** one consumer of the bus: a tag, a pixel, a tracker, a log — it takes the payload built for it */
export type Destination<N extends DestinationName = DestinationName> = {
  /** the destination's name: its key in every event and in the registration, its flag in the consent header */
  name: N;
  /** whether the destination's sdk is there to take events; default: always */
  ready?: (() => boolean) | undefined;
  send: (payload: RelayDestinations[N], meta: EventMeta) => void;
};

/** a destination of any registered name */
export type AnyDestination = { [N in DestinationName]: Destination<N> }[DestinationName];

/** the destinations by name: the key an event's payload sits under, which is also the destination's own name */
export type Destinations = { [N in DestinationName]?: Destination<N> | undefined };

export type RelayConfig<P extends Destinations = Destinations> = {
  destinations: P;
  /** the consent of exactly the registered destinations; `NoInfer` keeps `destinations` the only source of the names */
  consent: ConsentSource<NoInfer<keyof P & string>>;
  /**
   * log every tracked event to the console, with what each destination got or why not; a function is asked per event
   */
  debug?: boolean | (() => boolean) | undefined;
};

/** a consent source for whichever names: what the bus holds, as any `RelayConfig` narrows to it */
type ConsentHolder = Omit<ConsentSource, 'of'> & { of: (name: never) => ConsentAnswer };

/** the configuration as the bus takes it, whichever names it was typed for */
export type BusConfig = Omit<RelayConfig, 'consent'> & { consent: ConsentHolder };

export type Bus = {
  /** register the destinations; events tracked earlier are delivered now */
  configure: (config: BusConfig) => void;
  /** put an event on the bus; returns its id */
  track: (input: TrackInput) => string;
  /** re-check the destinations' consent and readiness: after the cmp's choice changed or a destination sdk appeared */
  notify: () => void;
  /** the consent as known now, by destination name: what a request to the server carries */
  consent: () => ConsentRecord;
};

export type BusEnvironment = {
  now?: (() => number) | undefined;
  /** schedules a readiness re-check; returns the cancel */
  schedule?: ((callback: () => void, ms: number) => () => void) | undefined;
};

// the destinations as the bus holds them: the payload type is the destination's business
type Registered = {
  name: string;
  ready?: (() => boolean) | undefined;
  send(payload: unknown, meta: EventMeta): void;
};

type Emitted = EventMeta & { event: RelayEvent };

/** what a destination gets: its payload of the event, under the event's meta */
type Pending = EventMeta & { payload: unknown };

type DestinationState = {
  destination: Registered;
  /** the deliveries made, by event key and id */
  delivered: Set<string>;
};

/** events kept in memory for destinations that are not ready or not consented yet */
const BUFFER_SIZE = 200;

const READY_POLL_MS = 200;
const READY_POLL_ATTEMPTS = 100;

export function createBus(env: BusEnvironment = {}): Bus {
  const now = env.now ?? (() => Date.now());
  const schedule = env.schedule ?? defaultSchedule;

  let states: DestinationState[] = [];
  // kept by destination name across configures, so a reconfigured destination gets nothing twice
  const delivered = new Map<string, Set<string>>();
  // a source is asked to call back once, however often the bus is configured with it
  const watched = new WeakSet<ConsentHolder>();
  let debug: RelayConfig['debug'];
  // the event being tracked right now: its deliveries belong to its own log group, later ones get their own
  let tracking: string | undefined;
  let consent: ConsentHolder = { names: [], of: () => {} };
  let free = new Set<string>();
  const buffer: Emitted[] = [];
  let cancelPoll: (() => void) | undefined;
  let pollAttempts = 0;

  const consentOf = (destination: Registered): ConsentAnswer =>
    free.has(destination.name) ? true : consent.of(destination.name as never);

  /** the consent as known now, by destination name; an unknown answer counts as not given */
  const consentRecord = (): ConsentRecord =>
    Object.fromEntries(
      states
        .filter(({ destination }) => !free.has(destination.name))
        .map(({ destination }) => [destination.name, consentOf(destination) === true]),
    );

  const dispatch = (): void => {
    let waiting = false;

    for (const state of states) {
      const { destination } = state;
      const allowed = consentOf(destination);

      // a cmp that has not read the stored choice yet is polled like a destination that has not loaded yet
      if (allowed === undefined) {
        waiting ||= buffer.length > 0;
        continue;
      }

      if (!allowed) continue;

      const pending = buffer
        .filter((emitted) => !state.delivered.has(deliveryOf(emitted)))
        .map((emitted) => pendingOf(emitted, destination))
        .filter((entry) => entry !== undefined);

      if (destination.ready?.() ?? true) {
        deliver(state, pending);
      } else {
        waiting ||= pending.length > 0;
      }
    }

    if (waiting) {
      poll();
    }
  };

  const deliver = (state: DestinationState, entries: readonly Pending[]): void => {
    for (const { payload, ...meta } of entries) {
      const delivery = deliveryOf(meta);

      if (state.delivered.has(delivery)) continue;

      state.delivered.add(delivery);

      try {
        state.destination.send(payload, meta);
      } catch (error) {
        console.error(`relay: destination ${state.destination.name} failed`, error);
      }

      if (tracking !== meta.id && debugging()) {
        reportLate(state.destination.name, payload, meta);
      }
    }
  };

  const debugging = (): boolean => (typeof debug === 'function' ? debug() : debug === true);

  /** what became of the event at each destination it carries a payload for, as things stand after the dispatch */
  const outcomesOf = (emitted: Emitted): Outcome[] => {
    const outcomes: Outcome[] = [];

    for (const state of states) {
      const { destination } = state;
      const payload = payloadOf(emitted.event, destination.name);

      if (payload === undefined) continue;

      const status = statusOf(state, emitted, consentOf(destination));

      outcomes.push({ name: destination.name, payload, status });
    }

    return outcomes;
  };

  /** the re-check after a choice or a destination sdk appeared: the poll starts over */
  const notify = (): void => {
    pollAttempts = 0;
    dispatch();
  };

  const poll = (): void => {
    if (cancelPoll || pollAttempts >= READY_POLL_ATTEMPTS) return;

    cancelPoll = schedule(() => {
      cancelPoll = undefined;
      pollAttempts += 1;
      dispatch();
    }, READY_POLL_MS);
  };

  return {
    configure(next) {
      const destinations = registeredDestinations(next.destinations);
      const answered = new Set([...next.consent.names, ...(next.consent.free ?? [])]);

      for (const destination of destinations) {
        if (!answered.has(destination.name)) {
          throw new Error(`relay: destination ${destination.name} has no consent source`);
        }
      }

      states = destinations.map((destination) => {
        const sent = delivered.get(destination.name) ?? new Set<string>();

        delivered.set(destination.name, sent);

        return { destination, delivered: sent };
      });
      consent = next.consent;
      free = new Set(next.consent.free);
      debug = next.debug;

      dispatch();

      if (!next.consent.watch || watched.has(next.consent)) return;

      watched.add(next.consent);
      next.consent.watch(notify);
    },

    track(input) {
      const { event, key, id: own } = toTracked(input);
      const id = eventIdOf(own);
      const unusable = unusableEventId(own, id);

      if (unusable) {
        console.error(`relay: ${unusable}`);
      }

      const emitted: Emitted = { id, at: now(), key, event };

      buffer.push(emitted);

      if (buffer.length > BUFFER_SIZE) {
        const evicted = buffer.splice(0, buffer.length - BUFFER_SIZE);

        for (const sent of delivered.values()) {
          for (const entry of evicted) sent.delete(deliveryOf(entry));
        }
      }

      pollAttempts = 0;
      tracking = emitted.id;
      dispatch();
      tracking = undefined;

      if (debugging()) {
        reportTracked(input, { id: emitted.id, at: emitted.at, key }, outcomesOf(emitted));
      }

      return emitted.id;
    },

    notify,

    consent: consentRecord,
  };
}

function statusOf(state: DestinationState, emitted: Emitted, allowed: ConsentAnswer): Outcome['status'] {
  if (state.delivered.has(deliveryOf(emitted))) return 'sent';
  if (allowed === undefined) return 'consent pending';
  if (!allowed) return 'declined';

  return 'waiting for sdk';
}

/** the destinations of a record, each checked to sit under its own name */
function registeredDestinations(destinations: Destinations): Registered[] {
  const registered: Registered[] = [];

  for (const [name, destination] of Object.entries(destinations) as [string, Registered | undefined][]) {
    if (!destination) continue;

    if (destination.name !== name) {
      throw new Error(`relay: destination ${destination.name} is registered under ${name}`);
    }

    registered.push(destination);
  }

  return registered;
}

/**
 * What a destination gets once: the event under its id. The same event tracked again under its own
 * id (a resubmitted order) is one conversion, another event under that id (the checkout before the
 * purchase, both under the order number) is not.
 */
function deliveryOf({ key, id }: EventMeta): string {
  return `${key ?? ''}\n${id}`;
}

function pendingOf(emitted: Emitted, destination: Registered): Pending | undefined {
  const payload = payloadOf(emitted.event, destination.name);

  return payload === undefined ? undefined : { id: emitted.id, at: emitted.at, key: emitted.key, payload };
}

function defaultSchedule(callback: () => void, ms: number): () => void {
  const handle = setTimeout(callback, ms);

  return () => clearTimeout(handle);
}
