import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type { ExtractionError } from './types.js';

/**
 * Rewrite compiled-output positions back to the authored source.
 *
 * Babel parses .astro files after Astro's compiler has rewritten them, so the
 * positions it reports refer to code the developer never wrote. Errors that
 * cannot be mapped keep the position babel gave them.
 */
export function mapErrorsToSource(errors: ExtractionError[], map: unknown): ExtractionError[] {
  if (errors.length === 0 || !map) {
    return errors;
  }

  let tracer: TraceMap;

  try {
    tracer = new TraceMap(map as never);
  } catch {
    return errors;
  }

  return errors.map((error) => {
    const position = originalPositionFor(tracer, { line: error.line, column: error.column });

    if (position.line === null) {
      return error;
    }

    return { ...error, line: position.line, column: position.column ?? error.column };
  });
}
