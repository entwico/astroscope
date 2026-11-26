import type { TranslationMeta } from './types.js';

export function normalizeMeta(meta: TranslationMeta | string): TranslationMeta {
  return typeof meta === 'string' ? { fallback: meta } : meta;
}
