import { getHealthStore } from './store.js';

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  latency?: number | undefined;
  error?: string | undefined;
}

export interface HealthCheckDefinition {
  /**
   * Unique name for this health check.
   */
  name: string;

  /**
   * Performs the check. Throw or return an unhealthy result to fail;
   * returning void or completing without error means healthy.
   */
  check: () => Promise<HealthCheckResult | void> | HealthCheckResult | void;

  /**
   * Optional checks don't affect the ready probe.
   * @default false
   */
  optional?: boolean | undefined;

  /**
   * Maximum time in ms for the check to complete.
   * @default 5000
   */
  timeout?: number | undefined;
}

/**
 * Register a health check against the adapter's health server.
 *
 * No-op when no health runtime is active (dev mode, `health: false`), so boot
 * files can call it unconditionally. Returns an unregister function; checks
 * still registered after `onShutdown` are removed automatically.
 */
export function registerHealthCheck(definition: HealthCheckDefinition): () => void {
  const store = getHealthStore();

  if (!store.registry) {
    return () => {};
  }

  const unregister = store.registry.register({
    name: definition.name,
    check: definition.check,
    ...(definition.optional !== undefined && { optional: definition.optional }),
    ...(definition.timeout !== undefined && { timeout: definition.timeout }),
  });

  store.unregisters.set(definition.name, unregister);

  return () => {
    const current = store.unregisters.get(definition.name);

    if (current) {
      store.unregisters.delete(definition.name);
      current();
    }
  };
}
