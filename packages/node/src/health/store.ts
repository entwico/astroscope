/**
 * Shared state between the public `registerHealthCheck` API and the server
 * runtime. Keyed on `globalThis` because the two sides may live in different
 * module instances (bundled app vs vite module runner in dev).
 */

const STORE_KEY = Symbol.for('@astroscope/node/health');

export interface RegistrableCheck {
  name: string;
  check: () => Promise<{ status: 'healthy' | 'unhealthy' } | void> | { status: 'healthy' | 'unhealthy' } | void;
  optional?: boolean;
  timeout?: number;
}

export interface ChecksRegistry {
  register(check: RegistrableCheck): () => void;
}

interface Store {
  registry: ChecksRegistry | undefined;
  unregisters: Map<string, () => void>;
}

export function getHealthStore(): Store {
  const g = globalThis as Record<symbol, unknown>;
  let store = g[STORE_KEY] as Store | undefined;

  if (!store) {
    store = { registry: undefined, unregisters: new Map() };
    g[STORE_KEY] = store;
  }

  return store;
}

export function activateHealthChecks(registry: ChecksRegistry): void {
  getHealthStore().registry = registry;
}

/**
 * Remove every check still registered and detach the registry. Runs after
 * `onShutdown`, so consumers get first chance to unregister themselves; this
 * guarantees a clean registry no matter what they forgot.
 */
export function deactivateHealthChecks(): void {
  const store = getHealthStore();

  for (const unregister of store.unregisters.values()) {
    unregister();
  }

  store.unregisters.clear();
  store.registry = undefined;
}
