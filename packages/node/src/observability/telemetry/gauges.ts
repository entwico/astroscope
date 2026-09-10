/**
 * Gauges have no "first use" to bind on: their callback must be registered on
 * a real meter, and a meter obtained before the SDK started is a no-op
 * forever. A creation that lands on the no-op meter is parked here and retried
 * by the SDK right after `sdk.start()`. Keyed on `globalThis` so the
 * vite-runner and native module instances share one list.
 */

const STORE_KEY = Symbol.for('@astroscope/node/telemetry.gauges');

/** returns whether the instrument bound to a real meter */
type Bind = () => boolean;

function getPending(): Bind[] {
  const g = globalThis as Record<symbol, unknown>;
  let pending = g[STORE_KEY] as Bind[] | undefined;

  if (!pending) {
    pending = [];
    g[STORE_KEY] = pending;
  }

  return pending;
}

export function registerGauge(bind: Bind): void {
  if (!bind()) {
    getPending().push(bind);
  }
}

export function bindGauges(): void {
  const pending = getPending();

  for (const bind of pending.splice(0)) {
    if (!bind()) {
      pending.push(bind);
    }
  }
}
