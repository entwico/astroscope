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

export function compileMessage(locale: string, message: string): CompiledTranslation {
  try {
    const mf = getOrCreateMessageFormat(locale, message);

    return (values) => mf.format(values);
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
): MessagePart<string>[] {
  try {
    const mf = getOrCreateMessageFormat(locale, message);

    return mf.formatToParts(values);
  } catch {
    // if MF2 parsing fails, return a single literal part with the raw message
    return [{ type: 'literal', value: message }];
  }
}

export function compileTranslations(locale: string, raw: RawTranslations): CompiledTranslations {
  const compiled: CompiledTranslations = {};

  for (const [key, message] of Object.entries(raw)) {
    compiled[key] = compileMessage(locale, message);
  }

  return compiled;
}
