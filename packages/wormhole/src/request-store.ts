/**
 * Per-request wormhole values for the islands emitter and the stream-end script —
 * both run while the response streams, outside the middleware's ALS scope, so the
 * request object is the only stable handle (same pattern as the i18n locale).
 */
export type RequestWormholes = {
  /** wormhole name → serializable value, as resolved by the middleware */
  values: ReadonlyMap<string, unknown>;
  /** names already written into the document by the islands emitter */
  emitted: Set<string>;
};

const requestWormholes = new WeakMap<Request, RequestWormholes>();

export function setRequestWormholes(request: Request, wormholes: RequestWormholes): void {
  requestWormholes.set(request, wormholes);
}

export function getRequestWormholes(request: Request): RequestWormholes | undefined {
  return requestWormholes.get(request);
}
