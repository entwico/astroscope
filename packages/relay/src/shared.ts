// imported by the server, the client and the destination entries — no node or astro runtime imports here

/**
 * The request header the browser's consent travels in: the names of the consented destinations,
 * comma-separated. The bus writes it onto every same-origin fetch, the middleware reads it.
 */
export const RELAY_CONSENT_HEADER = 'x-relay-consent';

/** the attribute of an element whose click tracks the event serialized into it */
export const RELAY_TRACK_ATTRIBUTE = 'data-track';

/** what the visitor allowed, by destination name */
export type ConsentRecord = Readonly<Record<string, boolean>>;

const MAX_CONSENT_NAMES = 32;
const DESTINATION_NAME = /^[\w-]{1,64}$/;

/** the header value: the names of the consented destinations, empty when none */
export function serializeConsent(consent: ConsentRecord): string {
  return Object.keys(consent)
    .filter((name) => consent[name] === true && DESTINATION_NAME.test(name))
    .join(',');
}

/** the record from an untrusted header value: unknown names are dropped, a missing header is nothing consented */
export function parseConsent(raw: string | null | undefined): ConsentRecord {
  if (!raw) return {};

  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => DESTINATION_NAME.test(name))
    .slice(0, MAX_CONSENT_NAMES);

  return Object.fromEntries(names.map((name) => [name, true]));
}

/**
 * The answer for one destination: `undefined` as long as the cmp has not read the stored choice yet
 * — not "no", but "not known", so events wait in memory instead of being dropped.
 */
export type ConsentAnswer = boolean | undefined;

/**
 * Where the bus asks whether the visitor allowed a destination: a cmp adapter (`ccm19()`), or three
 * members of your own. It covers exactly the registered names — `names` and `of` make the type
 * invariant in them — so a destination without an answer is a type error.
 */
export type ConsentSource<N extends string = string> = {
  /** the registered destination names */
  names: readonly N[];
  /** whether the visitor allowed the destination */
  of: (name: N) => ConsentAnswer;
  /** destinations needing no consent: taken before the cmp has answered, not in the record */
  free?: readonly N[] | undefined;
  /** called once with the re-check: hook it to the cmp's change event, so a choice on this page delivers at once */
  watch?: ((notify: () => void) => void) | undefined;
};

/**
 * The destinations an event can carry a payload for, by name: the package's destination entries and a
 * site's own add theirs through module augmentation of `@astroscope/relay`, so every event
 * definition is checked against the payload the destination takes. `id`, `key` and `event` are
 * reserved names.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by augmentation
export interface RelayDestinations {}

export type DestinationName = keyof RelayDestinations & string;

/** the parameters of an event as a destination's builder takes them */
export type RelayParams = Record<string, unknown>;

/** an event on the bus: the payload for each destination it is meant for, built by the destination's own builders */
export type RelayEvent = { [N in DestinationName]?: RelayDestinations[N] | undefined };

/**
 * An event a site defined: the definition's key, optionally the id it fires under (an order
 * number, so every destination counts a conversion once, on both sides), and the payloads it built.
 */
export type DomainEvent<E extends RelayEvent = RelayEvent> = {
  key: string;
  id?: string | undefined;
  event: E;
};

/** what a definition returns: the payloads, and the id where the site's data has one */
export type DefinedPayloads = RelayEvent & { id?: string | undefined };

/** what `track()`, `<Track>` and `data-track` take: a defined event or a plain one */
export type TrackInput = RelayEvent | DomainEvent;

/** a defined event: builds the event from the site's own arguments and carries its key */
export type EventDefinition<
  Args extends unknown[] = unknown[],
  E extends RelayEvent = RelayEvent,
  K extends string = string,
> = ((...args: Args) => DomainEvent<E>) & {
  readonly key: K;
};

/**
 * One of the site's events: a function that turns the site's own objects into the payloads of the
 * destinations the event is meant for, under the key that identifies it in a `data-track`
 * attribute and in logs. One export per event, so an island bundles only the events
 * it tracks and an event only an action imports never reaches the browser; the key is the export's
 * name.
 */
export function defineEvent<const K extends string, Args extends unknown[], E extends DefinedPayloads>(
  key: K,
  create: (...args: Args) => E,
): EventDefinition<Args, Omit<E, 'id'>, K> {
  const build = (...args: Args): DomainEvent<Omit<E, 'id'>> => {
    const { id, ...event } = create(...args);

    return id === undefined ? { key, event } : { key, id, event };
  };

  return Object.assign(build, { key });
}

export function isDomainEvent(input: TrackInput): input is DomainEvent {
  const candidate = input as Partial<DomainEvent>;

  return typeof candidate.key === 'string' && typeof candidate.event === 'object' && candidate.event !== null;
}

/** the payloads and, for a defined one, its key and own id */
export function toTracked(input: TrackInput): { event: RelayEvent; key: string | undefined; id: string | undefined } {
  return isDomainEvent(input)
    ? { event: input.event, key: input.key, id: input.id }
    : { event: input, key: undefined, id: undefined };
}

/** a plain object with the right shape, from untrusted json (an attribute, the queue, storage) */
export function isTrackInput(value: unknown): value is TrackInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const candidate = value as Partial<DomainEvent>;

  if (candidate.key === undefined && candidate.event === undefined) return true;

  return isDomainEvent(candidate as TrackInput);
}

/** the value of the `data-track` attribute of an element whose click tracks the event */
export function trackAttribute(input: TrackInput): string {
  return JSON.stringify(input);
}

/** the payload of a destination in an event, `undefined` when the event is not meant for it */
export function payloadOf(event: RelayEvent, name: string): unknown {
  return (event as Record<string, unknown>)[name];
}

/** what a destination knows about an event besides its payload */
export type EventMeta = {
  id: string;
  /** epoch milliseconds of the track call */
  at: number;
  /** the key of the definition the event came from, `undefined` for a plain event */
  key?: string | undefined;
};

/** `track()`, the same in the browser and on the server: puts the event on the bus, returns its id */
export type TrackFunction = (input: TrackInput) => string;

/** whether this runs in a browser: a runtime check, so the built package works outside vite too */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** a fresh event id: a uuid; `randomUUID` needs a secure context, random bytes do not */
export function createEventId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));

  bytes[6] = ((bytes[6] ?? 0) & 0x0F) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3F) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const MAX_ID_LENGTH = 64;
const EVENT_ID = /^[\w.:-]+$/;

/** a usable event id from an untrusted value: non-empty, printable, bounded */
export function isEventId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && EVENT_ID.test(value);
}

/** the id an event fires under: its own when it carries a usable one (an order number), else a fresh one */
export function eventIdOf(own: string | undefined): string {
  return isEventId(own) ? own : createEventId();
}

/**
 * Why an event does not fire under the id it came with, for the log of whoever tracked it: the
 * other side reports the conversion under the own id, so a replaced one counts twice.
 */
export function unusableEventId(own: unknown, id: string): string | undefined {
  if (own === undefined || isEventId(own)) return undefined;

  return `event id ${JSON.stringify(own)} is not usable (1 to ${MAX_ID_LENGTH} of A-Z, a-z, 0-9, _ . : -), the event fires under ${id} instead`;
}
