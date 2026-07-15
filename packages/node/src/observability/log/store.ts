import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';

/**
 * Shared state between the public `log` proxy and the server runtime. Keyed on
 * `globalThis` because the two sides may live in different module instances
 * (bundled app vs vite module runner in dev).
 */

const STORE_KEY = Symbol.for('@astroscope/node/log');

export const EARLY_LOG_BUFFER_CAP = 100;

export interface BufferedEntry {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  bindings: Record<string, unknown>[];
  args: unknown[];
  time: number;
}

export interface RequestRecord {
  logger: Logger | undefined;
  url: string;
  method: string;
  route: string | undefined;
  routeOverride: boolean;
  actionName: string | undefined;
}

export interface LogStore {
  root: Logger | undefined;
  requestStorage: AsyncLocalStorage<RequestRecord>;
  buffer: BufferedEntry[];
  dropped: number;
}

export function getLogStore(): LogStore {
  const g = globalThis as Record<symbol, unknown>;
  let store = g[STORE_KEY] as LogStore | undefined;

  if (!store) {
    store = { root: undefined, requestStorage: new AsyncLocalStorage(), buffer: [], dropped: 0 };
    g[STORE_KEY] = store;
  }

  return store;
}

export function getRequestRecord(): RequestRecord | undefined {
  return getLogStore().requestStorage.getStore();
}
