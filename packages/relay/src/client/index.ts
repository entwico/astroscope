import type { Destinations, RelayConfig } from './bus.js';
import { bus } from './instance.js';

export type { AnyDestination, Bus, BusConfig, BusEnvironment, Destination, Destinations, RelayConfig } from './bus.js';
export { createBus } from './bus.js';

/**
 * Types the browser half: the default export of `src/relay/client.ts`, which the integration loads
 * on every page and configures the bus with. A promise is awaited, for a setup that has to wait
 * for something first.
 */
export function defineRelayClient<P extends Destinations>(
  config: RelayConfig<P> | Promise<RelayConfig<P>>,
): RelayConfig<P> | Promise<RelayConfig<P>> {
  return config;
}

/**
 * Registers the destinations; events tracked earlier are delivered now. The integration does this with
 * the client module's default export.
 */
export function configureRelay<P extends Destinations>(config: RelayConfig<P>): void {
  bus.configure(config);
}

/** re-checks the destinations' consent and readiness: after the cmp's choice changed or a destination sdk appeared */
export function notifyRelay(): void {
  bus.notify();
}
