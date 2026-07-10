import { isSpanContextValid, trace } from '@opentelemetry/api';
import pino, { type Bindings, type Logger, type LoggerOptions } from 'pino';
import { getLogStore } from './store.js';

/**
 * Contract of the `src/log.ts` entry seam: pino logger options, or a factory
 * producing them. Never a logger instance — the platform constructs the
 * logger itself (after instrumentation, so trace correlation works).
 */
export type LoggerOptionsFactory = LoggerOptions | ((ctx: { dev: boolean }) => LoggerOptions | Promise<LoggerOptions>);

/**
 * Compose the user mixin (if any) with platform trace correlation: when a
 * span is active, every entry carries `trace_id` / `span_id` / `trace_flags`.
 */
function composeMixin(userMixin: LoggerOptions['mixin']): NonNullable<LoggerOptions['mixin']> {
  return (mergeObject, level, logger) => {
    const user = userMixin ? userMixin(mergeObject, level, logger) : {};
    const spanContext = trace.getActiveSpan()?.spanContext();

    if (!spanContext || !isSpanContextValid(spanContext)) return user;

    return {
      ...user,
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: `0${spanContext.traceFlags.toString(16)}`,
    };
  };
}

/**
 * Construct the root logger from the app's options seam and replay any logs
 * buffered before construction (original timestamps kept as `bufferedTime`).
 * In dev this runs once per generation; the buffer only exists the first time.
 */
export async function constructRootLogger(
  factory: LoggerOptionsFactory | undefined,
  ctx: { dev: boolean },
): Promise<Logger> {
  const store = getLogStore();
  const options = (typeof factory === 'function' ? await factory(ctx) : factory) ?? {};
  const root = pino({ level: 'info', ...options, mixin: composeMixin(options.mixin) });

  store.root = root;

  for (const entry of store.buffer.splice(0)) {
    const bindings = entry.bindings.length ? (Object.assign({}, ...entry.bindings) as Bindings) : {};
    const target = root.child({ ...bindings, bufferedTime: new Date(entry.time).toISOString() });

    (target[entry.level] as (...args: unknown[]) => void)(...entry.args);
  }

  if (store.dropped > 0) {
    root.warn({ dropped: store.dropped }, 'early log buffer overflowed, entries dropped');
    store.dropped = 0;
  }

  return root;
}

/**
 * Failure path for startups that die before the logger exists: dump the
 * buffered entries to the console so no phase is silent.
 */
export function dumpEarlyLogs(): void {
  const store = getLogStore();

  if (store.root) return;

  for (const entry of store.buffer.splice(0)) {
    const bindings = entry.bindings.length ? Object.assign({}, ...entry.bindings) : undefined;

    console.error(
      new Date(entry.time).toISOString(),
      entry.level.toUpperCase(),
      ...(bindings ? [bindings] : []),
      ...entry.args,
    );
  }

  if (store.dropped > 0) {
    console.error(`(${store.dropped} early log entries dropped)`);
    store.dropped = 0;
  }
}
