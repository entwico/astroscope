import { AsyncLocalStorage } from 'node:async_hooks';
import type { I18nContext } from './types.js';

const als = new AsyncLocalStorage<I18nContext>();

export function runWithContext<T>(context: I18nContext, fn: () => T): T {
  return als.run(context, fn);
}

export function getContext(): I18nContext | null {
  return als.getStore() ?? null;
}
