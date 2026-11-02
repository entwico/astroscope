// the tracing setup the unit tests share; not reachable from any entry, so never part of the build

import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { type SpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';

/** a tracer provider with the async-hooks context manager and the W3C propagators, as the sdk installs them */
export function registerTestTracing(spanProcessors: SpanProcessor[] = []): void {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(
    new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] }),
  );
  trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors }));
}
