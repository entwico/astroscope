import { MessageFormat, type MessagePart } from 'messageformat';
import { DraftFunctions } from 'messageformat/functions';

import type { CompiledTranslation, CompiledTranslations, RawTranslations } from './types.js';

// enable draft functions for :currency, :date, :datetime, :time, :percent, :unit
// bidi isolation is disabled: the default wraps string placeholders in invisible
// U+2068/U+2069 characters that end up in the DOM and copy-paste
const mfOptions = { functions: DraftFunctions, bidiIsolation: 'none' as const };

const cache = new Map<string, MessageFormat<string, string>>();

function getOrCreateMessageFormat(locale: string, message: string): MessageFormat<string, string> {
  const cacheKey = `${locale}:${message}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const mf = new MessageFormat(locale, message, mfOptions);

  cache.set(cacheKey, mf);

  return mf;
}

/** takes a formatting error (an unresolved variable, a bad input); messageformat renders its best effort */
export type FormatErrorHandler = (error: unknown) => void;

export function compileMessage(locale: string, message: string, onError?: FormatErrorHandler): CompiledTranslation {
  try {
    const mf = getOrCreateMessageFormat(locale, message);

    return (values) => mf.format(values, onError);
  } catch {
    // if MF2 parsing fails, return raw message so the problem is visible to the user
    return () => message;
  }
}

/**
 * Format a message to parts for rich text rendering.
 * Returns an array of MessagePart objects that can be processed
 * to build component trees with markup elements.
 */
export function formatMessageToParts(
  locale: string,
  message: string,
  values?: Record<string, unknown> | undefined,
  onError?: FormatErrorHandler,
): MessagePart<string>[] {
  try {
    const mf = getOrCreateMessageFormat(locale, message);

    return mf.formatToParts(values, onError);
  } catch {
    // if MF2 parsing fails, return a single literal part with the raw message
    return [{ type: 'literal', value: message }];
  }
}

/** an empty message is no message: it falls back like a missing key, as `rich()`, the chunks and the client do */
export function compileTranslations(
  locale: string,
  raw: RawTranslations,
  onError?: (key: string, error: unknown) => void,
): CompiledTranslations {
  // null prototype: a key like `__proto__` stays a translation instead of replacing the prototype
  const compiled: CompiledTranslations = Object.create(null) as CompiledTranslations;

  for (const [key, message] of Object.entries(raw)) {
    if (message === '') continue;

    compiled[key] = compileMessage(locale, message, onError && ((error) => onError(key, error)));
  }

  return compiled;
}
