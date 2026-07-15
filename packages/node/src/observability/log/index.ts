import { randomUUID } from 'node:crypto';
import pino, { type Bindings, type Logger } from 'pino';
import { type BufferedEntry, EARLY_LOG_BUFFER_CAP, type LogStore, getLogStore } from './store.js';

let fallbackLogger: Logger | undefined;

/**
 * Get the current request logger, root logger, or a plain fallback instance
 * when the root logger hasn't been constructed yet.
 * @internal
 */
function contextLogger(store: LogStore): Logger {
  return store.requestStorage.getStore()?.logger ?? store.root ?? (fallbackLogger ??= pino({ level: 'info' }));
}

/**
 * Generate a short request ID.
 * @internal
 */
export function generateReqId(): string {
  return randomUUID().slice(0, 8);
}

function bufferEntry(store: LogStore, level: BufferedEntry['level'], bindings: Bindings[], args: unknown[]): void {
  if (store.buffer.length >= EARLY_LOG_BUFFER_CAP) {
    store.dropped += 1;

    return;
  }

  store.buffer.push({ level, bindings, args, time: Date.now() });
}

/**
 * Log proxy interface — context-aware logging via getters.
 */
export interface LogProxy {
  /** Log at trace level */
  readonly trace: Logger['trace'];
  /** Log at debug level */
  readonly debug: Logger['debug'];
  /** Log at info level */
  readonly info: Logger['info'];
  /** Log at warn level */
  readonly warn: Logger['warn'];
  /** Log at error level */
  readonly error: Logger['error'];
  /** Log at fatal level */
  readonly fatal: Logger['fatal'];
  /** Create a child logger with additional bindings */
  child(bindings: Bindings): LogProxy;
  /** Access the current context's raw pino Logger */
  readonly raw: Logger;
  /** Access the root logger (no request context) */
  readonly root: Logger;
}

/**
 * Create a log proxy carrying accumulated child bindings. Before the root
 * logger is constructed, entries are buffered (with their bindings) and
 * replayed through the real logger on construction.
 */
function createLogProxy(bindings: Bindings[]): LogProxy {
  const store = getLogStore();

  // cache the derived child against the logger it was derived from, so a
  // proxy created before construction transparently rebinds afterwards
  let cachedBase: Logger | undefined;
  let cachedChild: Logger | undefined;

  const resolve = (): Logger => {
    const base = contextLogger(store);

    if (!bindings.length) return base;

    if (cachedBase !== base) {
      cachedBase = base;
      cachedChild = base.child(Object.assign({}, ...bindings) as Bindings);
    }

    return cachedChild!;
  };

  const method = (level: BufferedEntry['level']) => {
    if (!store.root) {
      const record = store.requestStorage.getStore();

      // request-scoped loggers exist only after construction; buffer otherwise
      if (!record?.logger) {
        return (...args: unknown[]) => bufferEntry(store, level, bindings, args);
      }
    }

    const logger = resolve();

    return logger[level].bind(logger);
  };

  return {
    get trace() {
      return method('trace') as Logger['trace'];
    },
    get debug() {
      return method('debug') as Logger['debug'];
    },
    get info() {
      return method('info') as Logger['info'];
    },
    get warn() {
      return method('warn') as Logger['warn'];
    },
    get error() {
      return method('error') as Logger['error'];
    },
    get fatal() {
      return method('fatal') as Logger['fatal'];
    },
    child(childBindings: Bindings): LogProxy {
      return createLogProxy([...bindings, childBindings]);
    },
    get raw() {
      return resolve();
    },
    get root() {
      const base = getLogStore().root ?? (fallbackLogger ??= pino({ level: 'info' }));

      return bindings.length ? base.child(Object.assign({}, ...bindings) as Bindings) : base;
    },
  };
}

/**
 * Context-aware logger. Inside a request, entries carry the request bindings
 * (`reqId`, `req`); outside they go to the root logger. Entries logged before
 * the root logger is constructed (env loading, config, instrumentation) are
 * buffered and replayed once construction completes — the original timestamp
 * is kept as a `bufferedTime` field.
 *
 * @example
 * ```ts
 * import { log } from '@astroscope/node/log';
 *
 * log.info('handling request');
 * log.info({ userId: 123 }, 'user logged in');
 * log.error(err, 'operation failed');
 *
 * const dbLog = log.child({ component: 'db' });
 * dbLog.debug('executing query');
 * ```
 */
export const log: LogProxy = createLogProxy([]);

// public surface for middleware that serves a route astro never matched
export { overrideRequestRoute } from '../request-route.js';

// re-exported so apps don't need a direct pino dependency for typing
export type { Logger, LoggerOptions, Bindings } from 'pino';

// contract of the src/log.ts entry seam
export type { LoggerOptionsFactory } from './construct.js';
