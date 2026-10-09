import type { BootContext } from './types.js';

export type BootEventName = 'beforeOnStartup' | 'afterOnStartup' | 'beforeOnShutdown' | 'afterOnShutdown';

export type BootEventHandler = (context: BootContext) => Promise<void> | void;

const STORE_KEY = Symbol.for('@astroscope/node/boot-events');

interface EventStore {
  listeners: Map<BootEventName, Set<BootEventHandler>>;
}

function getStore(): EventStore {
  const existing = (globalThis as Record<symbol, EventStore | undefined>)[STORE_KEY];

  if (existing) return existing;

  const store: EventStore = { listeners: new Map() };

  // eslint-disable-next-line unicorn/no-global-object-property-assignment -- Symbol.for store on globalThis, shared across module instances
  (globalThis as Record<symbol, EventStore>)[STORE_KEY] = store;

  return store;
}

export function on(event: BootEventName, handler: BootEventHandler): void {
  const store = getStore();
  let handlers = store.listeners.get(event);

  if (!handlers) {
    handlers = new Set();
    store.listeners.set(event, handlers);
  }

  handlers.add(handler);
}

export function off(event: BootEventName, handler: BootEventHandler): void {
  const store = getStore();

  store.listeners.get(event)?.delete(handler);
}

/** handlers run sequentially, each awaited */
export async function emit(event: BootEventName, context: BootContext): Promise<void> {
  const store = getStore();
  const handlers = store.listeners.get(event);

  if (!handlers) return;

  for (const handler of handlers) {
    await handler(context);
  }
}
