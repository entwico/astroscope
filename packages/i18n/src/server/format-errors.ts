import { log } from '@astroscope/node/log';
import type { FormatErrorHandler } from '../shared/compiler.js';

const reported = new Set<string>();

/**
 * Logs a message's formatting errors once per locale, key and message, through the platform
 * logger: messageformat's own default is a process warning per render. The message is part of the
 * identity so a corrected translation reports its own errors again.
 */
export function formatErrorReporter(locale: string, key: string, message: string): FormatErrorHandler {
  return (error) => {
    const identity = `${locale}:${key}:${message}`;

    if (reported.has(identity)) {
      return;
    }

    reported.add(identity);
    log.error({ err: error, key, locale }, 'translation failed to format');
  };
}
