import type { BootContext } from './types.js';

// keyed on globalThis via Symbol.for so the vite-runner and native module instances share it
const STORE_KEY = Symbol.for('@astroscope/node/boot-context');

export function setBootContext(context: BootContext): void {
  (globalThis as Record<symbol, BootContext | undefined>)[STORE_KEY] = context;
}

/**
 * The boot context of the server running in this process, or `undefined` when
 * no @astroscope/node server has booted (unit tests, one-off scripts).
 *
 * Available from the platform seams (`src/config.ts` and later) onwards;
 * libraries can use it to adapt behavior to dev mode without requiring
 * consumers to thread the flag through.
 */
export function getBootContext(): BootContext | undefined {
  return (globalThis as Record<symbol, BootContext | undefined>)[STORE_KEY];
}
