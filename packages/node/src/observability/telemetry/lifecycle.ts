import { type Context, type Span, SpanStatusCode, context, trace } from '@opentelemetry/api';

const LIB_NAME = '@astroscope/node';

/**
 * Lifecycle spans (`startup` / `shutdown` with phase children). No-op when no
 * SDK is registered — `trace.getTracer` returns the no-op tracer.
 */

export function startLifecycleSpan(name: string, parent?: Context): { span: Span; context: Context } {
  const parentContext = parent ?? context.active();
  const span = trace.getTracer(LIB_NAME).startSpan(name, undefined, parentContext);

  return { span, context: trace.setSpan(parentContext, span) };
}

export async function withLifecycleSpan<T>(name: string, parent: Context, fn: () => Promise<T> | T): Promise<T> {
  const { span, context: spanContext } = startLifecycleSpan(name, parent);

  try {
    const result = await context.with(spanContext, fn);

    span.setStatus({ code: SpanStatusCode.OK });

    return result;
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : 'unknown error' });

    throw err;
  } finally {
    span.end();
  }
}
