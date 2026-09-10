import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SpanStatusCode, metrics as metricsApi } from '@opentelemetry/api';
import { metrics, node, tracing } from '@opentelemetry/sdk-node';
import pino, { type DestinationStream } from 'pino';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { createRequestInstrumentation } from '../observability/instrument';
import { getLogStore, getRequestRecord } from '../observability/log/store';
import { writeResponse } from './serve-app';

const spans = new tracing.InMemorySpanExporter();
const reader = new metrics.PeriodicExportingMetricReader({
  exporter: new metrics.InMemoryMetricExporter(metrics.AggregationTemporality.CUMULATIVE),
  exportIntervalMillis: 60_000,
});

beforeAll(() => {
  new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(spans)] }).register();
  metricsApi.setGlobalMeterProvider(new metrics.MeterProvider({ readers: [reader] }));
});

const servers: Server[] = [];
const logLines: Record<string, unknown>[] = [];

const sink: DestinationStream = {
  write: (msg: string) => {
    logLines.push(JSON.parse(msg) as Record<string, unknown>);
  },
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));

  spans.reset();
  logLines.length = 0;
  getLogStore().root = undefined;
});

/** serves `respond()` through the request instrumentation and the app write loop */
async function startServer(respond: () => Response): Promise<string> {
  getLogStore().root = pino({ base: null }, sink);

  const instrument = createRequestInstrumentation({
    logging: { exclude: [], extended: false },
    telemetry: { exclude: [] },
  });
  const server = createServer((req, res) =>
    instrument(req, res, () => {
      getRequestRecord()!.route = '/page';

      void writeResponse(respond(), res);
    }),
  );

  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function failingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('<html><body>partial'));
      setTimeout(() => controller.error(new Error('island exploded')), 10);
    },
  });
}

describe('writeResponse', () => {
  test('streams the body and completes the request', async () => {
    const url = await startServer(
      () => new Response('<html>ok</html>', { status: 201, headers: { 'content-type': 'text/html' } }),
    );

    const response = await fetch(url);

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(await response.text()).toBe('<html>ok</html>');

    await vi.waitFor(() => expect(logLines.some((line) => line['msg'] === 'request completed')).toBe(true));
  });

  test('multiple set-cookie headers reach the client separately', async () => {
    const url = await startServer(() => {
      const headers = new Headers();

      headers.append('set-cookie', 'a=1');
      headers.append('set-cookie', 'b=2');

      return new Response('ok', { headers });
    });

    const response = await fetch(url);

    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
  });

  test('a render failing mid-stream is logged, marked on the span and counted', async () => {
    const url = await startServer(() => new Response(failingBody(), { headers: { 'content-type': 'text/html' } }));

    const response = await fetch(url);

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();

    await vi.waitFor(() => expect(logLines.length).toBeGreaterThanOrEqual(2));

    const failure = logLines.find(
      (line) => line['msg'] === 'render failed after the response started, response truncated',
    );
    const completion = logLines.find((line) => line['msg'] === 'request truncated');

    expect(failure?.['level']).toBe(50);
    expect(failure?.['route']).toBe('/page');
    expect((failure?.['err'] as { message: string }).message).toBe('island exploded');
    expect(failure?.['reqId']).toBe(completion?.['reqId']);

    expect(completion?.['level']).toBe(50);
    expect(completion?.['truncated']).toBe(true);
    expect((completion?.['res'] as { statusCode: number }).statusCode).toBe(200);

    await vi.waitFor(() => expect(spans.getFinishedSpans().find((s) => s.name === 'GET')).toBeDefined());

    const span = spans.getFinishedSpans().find((s) => s.name === 'GET');

    expect(span?.attributes['astro.response.truncated']).toBe(true);
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'response truncated' });

    const { resourceMetrics } = await reader.collect();
    const failures = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === 'astro.render.failures');

    expect(failures?.dataPoints[0]?.attributes).toEqual({ 'http.route': '/page' });
    expect(failures?.dataPoints[0]?.value).toBe(1);
  });
});
