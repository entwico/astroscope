import type { ExcludePattern } from '@astroscope/node/excludes';
import type { APIContext } from 'astro';
import type { ConsentRecord, DestinationName, EventMeta, RelayDestinations } from './shared.js';

/** what a server destination gets from the request the conversion arrived with */
export type RelayRequest = {
  /** the visitor's address, `undefined` when the adapter has none */
  clientAddress: string | undefined;
  headers: Headers;
  /** a cookie's value, for the click ids the pixels set */
  cookie: (name: string) => string | undefined;
  /** the page the conversion happened on: the referer, else the site's base url */
  sourceUrl: string;
};

/** what a server destination knows about an event: the browser's meta and the request */
export type ServerEventMeta = EventMeta & {
  request: RelayRequest;
};

/**
 * The server half of a destination: reports a conversion through its conversions api, or records it
 * first-party. The same shape as a browser destination — a name, its consent, a `send` of its payload.
 */
export type ServerDestination<N extends DestinationName = DestinationName> = {
  /** the destination's name: its key in every event; by default also the browser destination whose consent it shares */
  name: N;
  /** reports the payload; what it resolves to is logged with the report, e.g. the api's receipt */
  send: (payload: RelayDestinations[N], meta: ServerEventMeta) => ServerReceipt | Promise<ServerReceipt>;
};

/** what a conversions api answered, for the log: a trace id, a count — or nothing */
export type ServerReceipt = Record<string, string | number | undefined> | undefined | void;

/** a server destination of any registered name */
export type AnyServerDestination = { [N in DestinationName]: ServerDestination<N> }[DestinationName];

/** the server destinations by name: the key an event's payload sits under, which is also the destination's own name */
export type ServerDestinations = { [N in DestinationName]?: ServerDestination<N> | undefined };

/**
 * The consent per server destination, where the default — the flag of its name in the record the
 * request carried — does not fit: `false` for a first-party record that needs none, a function
 * answering from the record (another destination's flag).
 */
export type ServerConsent<N extends string> = { [K in N]?: false | ((consent: ConsentRecord) => boolean) | undefined };

export type RelayServerConfig<P extends ServerDestinations = ServerDestinations> = {
  destinations: P;
  consent?: ServerConsent<NoInfer<keyof P & string>> | undefined;
  /**
   * Requests whose conversions are not reported — test sessions, crawlers — as the path patterns or
   * the predicate every astroscope middleware takes.
   */
  exclude?: ExcludePattern[] | ((ctx: APIContext) => boolean) | undefined;
};

/** types the server registry: the default export of `src/relay/server.ts` */
export function defineRelayServer<P extends ServerDestinations>(config: RelayServerConfig<P>): RelayServerConfig<P> {
  return config;
}
