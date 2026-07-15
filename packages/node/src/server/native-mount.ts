import type { IncomingMessage, ServerResponse } from 'node:http';
import { log } from '../observability/log/index.js';
import { overrideRequestRoute } from '../observability/request-route.js';

/**
 * Native mounts: raw `(req, res)` handlers dispatched before static/astro,
 * for Node libraries that need the real request and response (e.g.
 * `oidc-provider`'s `callback()`). Mounted requests bypass astro middleware
 * entirely but stay inside request logging and tracing.
 *
 * Keyed on `globalThis` because registration (boot file, vite runner in dev)
 * and dispatch (server runtime) may live in different module instances.
 */

const STORE_KEY = Symbol.for('@astroscope/node/native-mounts');

export type NativeHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface NativeMountMatcher {
  /** match requests whose pathname starts with this prefix */
  prefix?: string | undefined;

  /** predicate over the native request; evaluated when no prefix mount matches */
  match?: ((req: IncomingMessage) => boolean) | undefined;

  /** route label for logs, metrics and span names; defaults to the prefix */
  name?: string | undefined;
}

interface Mount {
  prefix: string | undefined;
  match: ((req: IncomingMessage) => boolean) | undefined;
  name: string | undefined;
  handler: NativeHandler;
}

interface Store {
  mounts: Mount[];
}

function getStore(): Store {
  const g = globalThis as Record<symbol, unknown>;
  let store = g[STORE_KEY] as Store | undefined;

  if (!store) {
    store = { mounts: [] };
    g[STORE_KEY] = store;
  }

  return store;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (!pathname.startsWith(prefix)) return false;

  const rest = pathname.slice(prefix.length);

  return rest === '' || rest.startsWith('/') || rest.startsWith('?');
}

/**
 * Mount a native `(req, res)` handler on the adapter's server. The handler
 * owns the response completely — matched requests never reach astro
 * middleware or rendering. Dispatch happens before static file serving, in
 * production and dev alike.
 *
 * Call from `onStartup`. Returns an unregister function; mounts still
 * registered after `onShutdown` are removed automatically.
 *
 * When several prefix mounts match, the longest prefix wins; predicate
 * mounts are consulted afterwards in registration order.
 *
 * @example
 * ```ts
 * // src/boot.ts
 * import { mountNativeHandler } from '@astroscope/node/native';
 *
 * export function onStartup() {
 *   mountNativeHandler({ prefix: '/oidc', name: 'oidc' }, getOidcProvider().callback());
 * }
 * ```
 */
export function mountNativeHandler(matcher: NativeMountMatcher, handler: NativeHandler): () => void {
  if (!matcher.prefix && !matcher.match) {
    throw new Error('[@astroscope/node] mountNativeHandler requires a prefix or a match predicate');
  }

  const mount: Mount = {
    prefix: matcher.prefix,
    match: matcher.match,
    name: matcher.name ?? matcher.prefix,
    handler,
  };

  const store = getStore();

  store.mounts.push(mount);

  return () => {
    const index = store.mounts.indexOf(mount);

    if (index !== -1) store.mounts.splice(index, 1);
  };
}

/**
 * Remove every registered mount. Runs after `onShutdown` (prod) and between
 * dev generations, so re-running `onStartup` never stacks duplicates.
 */
export function clearNativeMounts(): void {
  getStore().mounts.length = 0;
}

function findMount(req: IncomingMessage): Mount | undefined {
  const url = req.url ?? '';
  const queryIndex = url.indexOf('?');
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);

  let best: Mount | undefined;

  for (const mount of getStore().mounts) {
    if (mount.prefix && matchesPrefix(pathname, mount.prefix)) {
      if (!best?.prefix || mount.prefix.length > best.prefix.length) {
        best = mount;
      }
    }
  }

  if (best) return best;

  return getStore().mounts.find((mount) => mount.match?.(req));
}

function failResponse(res: ServerResponse): void {
  if (res.writableEnded) return;

  if (!res.headersSent) {
    res.writeHead(500, { 'content-type': 'text/plain' });
  }

  res.end('Internal Server Error');
}

/**
 * Dispatch a request to a matching mount. Returns `false` when no mount
 * matches — the caller continues with static/astro handling.
 */
export function dispatchNativeMount(req: IncomingMessage, res: ServerResponse): boolean {
  const mount = findMount(req);

  if (!mount) return false;

  // the mount, not astro's routing, is what serves this request
  if (mount.name) {
    overrideRequestRoute(mount.name);
  }

  try {
    const result = mount.handler(req, res);

    if (result instanceof Promise) {
      result.catch((err: unknown) => {
        log.error(err instanceof Error ? { err } : { reason: err }, 'native mount handler failed');
        failResponse(res);
      });
    }
  } catch (err) {
    log.error(err instanceof Error ? { err } : { reason: err }, 'native mount handler failed');
    failResponse(res);
  }

  return true;
}
