import { type Span, SpanStatusCode, context, metrics as metricsApi, trace } from '@opentelemetry/api';
import { metrics, node, tracing } from '@opentelemetry/sdk-node';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { bindGauges } from './gauges';
import {
  DURATION_BUCKETS,
  createCounter,
  createHistogram,
  createObservableGauge,
  createUpDownCounter,
  errorType,
  withSpan,
} from './telemetry';

const spans = new tracing.InMemorySpanExporter();

beforeAll(() => {
  new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }).register();
});

let provider: metrics.MeterProvider | undefined;
let reader: metrics.PeriodicExportingMetricReader | undefined;

function registerMeterProvider(): void {
  reader = new metrics.PeriodicExportingMetricReader({
    exporter: new metrics.InMemoryMetricExporter(metrics.AggregationTemporality.CUMULATIVE),
    exportIntervalMillis: 60_000,
  });
  provider = new metrics.MeterProvider({ readers: [reader] });

  metricsApi.setGlobalMeterProvider(provider);
}

async function collect(name: string): Promise<{ scope: string; metric: metrics.MetricData } | undefined> {
  const { resourceMetrics } = await reader!.collect();

  for (const scope of resourceMetrics.scopeMetrics) {
    const metric = scope.metrics.find((m) => m.descriptor.name === name);

    if (metric) return { scope: scope.scope.name, metric };
  }

  return undefined;
}

afterEach(async () => {
  spans.reset();
  metricsApi.disable();

  await provider?.shutdown();

  provider = undefined;
  reader = undefined;
});

describe('instruments', () => {
  test('a histogram carries its buckets and scope', async () => {
    registerMeterProvider();

    const histogram = createHistogram('test.duration', {
      scope: '@astroscope/test',
      unit: 's',
      buckets: DURATION_BUCKETS.io,
    });

    histogram.record(0.003, { route: '/a' });

    const found = await collect('test.duration');
    const point = found?.metric.dataPoints[0] as metrics.DataPoint<metrics.Histogram>;

    expect(found?.scope).toBe('@astroscope/test');
    expect(found?.metric.descriptor.unit).toBe('s');
    expect(point.attributes).toEqual({ route: '/a' });
    expect(point.value.buckets.boundaries).toEqual(DURATION_BUCKETS.io);
    expect(point.value.count).toBe(1);
  });

  test('values recorded before a meter provider exists are dropped, later ones bind', async () => {
    const counter = createCounter('test.early');

    counter.add(1);

    registerMeterProvider();

    counter.add(2);

    const found = await collect('test.early');

    expect(found?.scope).toBe('@astroscope/node');
    expect(found?.metric.dataPoints[0]?.value).toBe(2);
  });

  test('an up-down counter goes both ways', async () => {
    registerMeterProvider();

    const active = createUpDownCounter('test.active', { unit: '{request}' });

    active.add(1);
    active.add(1);
    active.add(-1);

    expect((await collect('test.active'))?.metric.dataPoints[0]?.value).toBe(1);
  });

  test('an observable gauge created before the sdk is bound when the sdk starts', async () => {
    let age = 5;

    createObservableGauge('test.age', { unit: 's' }, (result) => result.observe(age, { locale: 'en' }));

    registerMeterProvider();

    expect(await collect('test.age')).toBeUndefined();

    bindGauges();

    age = 7;

    const point = (await collect('test.age'))?.metric.dataPoints[0];

    expect(point?.value).toBe(7);
    expect(point?.attributes).toEqual({ locale: 'en' });
  });

  test('an observable gauge created after the sdk started binds immediately', async () => {
    registerMeterProvider();
    bindGauges();

    createObservableGauge('test.late', {}, (result) => result.observe(1));

    expect((await collect('test.late'))?.metric.dataPoints[0]?.value).toBe(1);
  });
});

describe('errorType', () => {
  test('names the error class, else the value type', () => {
    class NotFound extends Error {}

    expect(errorType(new NotFound('x'))).toBe('NotFound');
    expect(errorType(new TypeError('x'))).toBe('TypeError');
    expect(errorType('boom')).toBe('string');
  });
});

describe('withSpan', () => {
  test('a synchronous function stays synchronous and ends the span ok', () => {
    const value = withSpan('sync', { attributes: { a: 1 } }, () => 42);

    expect(value).toBe(42);

    const [span] = spans.getFinishedSpans();

    expect(span?.name).toBe('sync');
    expect(span?.attributes).toEqual({ a: 1 });
    expect(span?.status.code).toBe(SpanStatusCode.OK);
  });

  test('the span is active inside the function', () => {
    const { span } = withSpan('outer', {}, () => ({ span: trace.getActiveSpan() })) as { span: Span | undefined };

    expect(span?.spanContext().spanId).toBe(spans.getFinishedSpans()[0]?.spanContext().spanId);
  });

  test('a synchronous throw marks the span failed and rethrows', () => {
    expect(() =>
      withSpan('throws', {}, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    const [span] = spans.getFinishedSpans();

    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'boom' });
  });

  test('a rejected promise marks the span failed', async () => {
    await expect(withSpan('rejects', {}, () => Promise.reject(new Error('later')))).rejects.toThrow('later');

    expect(spans.getFinishedSpans()[0]?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'later' });
  });

  test('the parent option nests the span outside the active context', async () => {
    const parent = trace.getTracer('test').startSpan('parent');
    const parentContext = trace.setSpan(context.active(), parent);

    await withSpan('child', { parent: parentContext, scope: '@astroscope/test' }, async () => undefined);

    parent.end();

    const child = spans.getFinishedSpans().find((s) => s.name === 'child');

    expect(child?.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(child?.instrumentationScope.name).toBe('@astroscope/test');
  });
});
