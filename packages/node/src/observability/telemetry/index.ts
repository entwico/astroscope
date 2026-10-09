import { type MaybePromise, maybeThen } from '@entwico/dash';
import {
  type Attributes,
  type Context,
  type Counter,
  type Histogram,
  type Meter,
  type Span,
  type SpanKind,
  SpanStatusCode,
  type UpDownCounter,
  ValueType,
  context,
  createNoopMeter,
  metrics,
  trace,
} from '@opentelemetry/api';
import { registerGauge } from './gauges.js';

/**
 * The telemetry seam for the astroscope packages — internal api, not for app
 * code (which uses `@opentelemetry/api` against the same SDK). Instruments
 * bind to the SDK meter lazily (a meter obtained before `startTelemetry()` is
 * a no-op forever, so a handle keeps trying until a real meter answers),
 * names, units and buckets have one owner, and no package needs its own
 * `@opentelemetry/api` copy. Without a started SDK — dev by default, or
 * `telemetry: false` — every call resolves to the api's no-op implementation.
 * @internal
 */

const DEFAULT_SCOPE = '@astroscope/node';

// the no-op meter hands out singletons — the tell for "no SDK registered yet"
const noopMeter = createNoopMeter();
const NOOP_HISTOGRAM = noopMeter.createHistogram('noop');
const NOOP_COUNTER = noopMeter.createCounter('noop');
const NOOP_UP_DOWN_COUNTER = noopMeter.createUpDownCounter('noop');
const NOOP_OBSERVABLE_GAUGE = noopMeter.createObservableGauge('noop');

export interface InstrumentOptions {
  /** instrumentation scope, `@astroscope/<package>`; defaults to `@astroscope/node` */
  scope?: string | undefined;
  description?: string | undefined;
  /** UCUM unit, e.g. `s`, `{request}` */
  unit?: string | undefined;
}

export interface HistogramOptions extends InstrumentOptions {
  /** explicit bucket boundaries; the SDK default set starts at 5, useless for seconds */
  buckets: readonly number[];
}

export interface HistogramHandle {
  record(value: number, attributes?: Attributes | undefined): void;
}

export interface CounterHandle {
  add(value: number, attributes?: Attributes | undefined): void;
}

/** what an observable gauge callback reports: one value per attribute set */
export interface ObservableHandle {
  observe(value: number, attributes?: Attributes | undefined): void;
}

/**
 * Bucket boundaries in seconds for the three kinds of durations the platform
 * measures: `http` is the semconv set for server requests, `io` covers one
 * outbound call (1 ms – 2.5 s), `compute` a synchronous render (10 µs – 50 ms).
 */
export const DURATION_BUCKETS = {
  http: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
  io: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  compute: [0.00001, 0.00005, 0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.05],
} as const satisfies Record<string, readonly number[]>;

function getMeter(options: InstrumentOptions): Meter {
  return metrics.getMeter(options.scope ?? DEFAULT_SCOPE);
}

function describe(options: InstrumentOptions): { description?: string; unit?: string } {
  return {
    ...(options.description && { description: options.description }),
    ...(options.unit && { unit: options.unit }),
  };
}

// binds on first use after a real meter is registered; until then every use
// creates a no-op instrument and drops the value
function bindLazily<T>(create: () => T, noop: T): () => T | undefined {
  let instrument: T | undefined;

  return () => {
    if (instrument === undefined) {
      const created = create();

      if (created === noop) {
        return undefined;
      }

      instrument = created;
    }

    return instrument;
  };
}

export function createHistogram(name: string, options: HistogramOptions): HistogramHandle {
  const bound = bindLazily<Histogram>(
    () =>
      getMeter(options).createHistogram(name, {
        ...describe(options),
        valueType: ValueType.DOUBLE,
        advice: { explicitBucketBoundaries: [...options.buckets] },
      }),
    NOOP_HISTOGRAM,
  );

  return { record: (value, attributes) => bound()?.record(value, attributes) };
}

export function createCounter(name: string, options: InstrumentOptions = {}): CounterHandle {
  const bound = bindLazily<Counter>(
    () => getMeter(options).createCounter(name, { ...describe(options), valueType: ValueType.INT }),
    NOOP_COUNTER,
  );

  return { add: (value, attributes) => bound()?.add(value, attributes) };
}

export function createUpDownCounter(name: string, options: InstrumentOptions = {}): CounterHandle {
  const bound = bindLazily<UpDownCounter>(
    () => getMeter(options).createUpDownCounter(name, { ...describe(options), valueType: ValueType.INT }),
    NOOP_UP_DOWN_COUNTER,
  );

  return { add: (value, attributes) => bound()?.add(value, attributes) };
}

/**
 * An asynchronous gauge: `observe` runs at every collection (the Prometheus
 * scrape) and reports the current values. Registered with the SDK when it
 * starts, so calling this at module level is fine.
 */
export function createObservableGauge(
  name: string,
  options: InstrumentOptions,
  observe: (result: ObservableHandle) => void,
): void {
  registerGauge(() => {
    const gauge = getMeter(options).createObservableGauge(name, { ...describe(options), valueType: ValueType.DOUBLE });

    if (gauge === NOOP_OBSERVABLE_GAUGE) {
      return false;
    }

    gauge.addCallback((result) => observe({ observe: (value, attributes) => result.observe(value, attributes) }));

    return true;
  });
}

/** the `error.type` attribute value for a thrown value: the error's class, else its type */
export function errorType(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor.name || error.name || 'Error';
  }

  return typeof error;
}

export interface SpanOptions {
  /** instrumentation scope, `@astroscope/<package>`; defaults to `@astroscope/node` */
  scope?: string | undefined;
  attributes?: Attributes | undefined;
  kind?: SpanKind | undefined;
  /** parent context; defaults to the active one (the request span inside a request) */
  parent?: Context | undefined;
}

export interface StartedSpan {
  span: Span;
  /** the context with `span` active — pass as `parent` to nest children */
  context: Context;
}

/** starts a span the caller ends itself; `withSpan` for work that is one function */
export function startSpan(name: string, options: SpanOptions = {}): StartedSpan {
  const parent = options.parent ?? context.active();
  const span = trace.getTracer(options.scope ?? DEFAULT_SCOPE).startSpan(
    name,
    {
      ...(options.attributes && { attributes: options.attributes }),
      ...(options.kind !== undefined && { kind: options.kind }),
    },
    parent,
  );

  return { span, context: trace.setSpan(parent, span) };
}

function endSpan(span: Span, error: unknown, failed: boolean): void {
  if (failed) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'unknown error' });
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }

  span.end();
}

/**
 * Runs `fn` inside a span: status from the outcome, the span active for
 * everything `fn` awaits. A synchronous `fn` stays synchronous — no promise
 * is allocated on the common path.
 */
export function withSpan<T>(name: string, options: SpanOptions, fn: () => MaybePromise<T>): MaybePromise<T> {
  const { span, context: spanContext } = startSpan(name, options);
  let result: MaybePromise<T>;

  try {
    result = context.with(spanContext, fn);
  } catch (error) {
    endSpan(span, error, true);

    throw error;
  }

  return maybeThen(
    result,
    (value) => {
      endSpan(span, undefined, false);

      return value;
    },
    (error: unknown) => {
      endSpan(span, error, true);

      throw error;
    },
  );
}
