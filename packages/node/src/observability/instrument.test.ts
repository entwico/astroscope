import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { node, tracing } from '@opentelemetry/sdk-node';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { type RequestInstrumentationConfig, createRequestInstrumentation } from './instrument';

const exporter = new tracing.InMemorySpanExporter();

beforeAll(() => {
  // register() installs the async-hooks context manager and W3C propagators
  new node.NodeTracerProvider({
    spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
  }).register();
});

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));

  exporter.reset();
});

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  config?: Partial<RequestInstrumentationConfig>,
): Promise<string> {
  const instrument = createRequestInstrumentation({ logging: false, telemetry: { exclude: [] }, ...config });
  const server = createServer((req, res) => instrument(req, res, () => handler(req, res)));

  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function waitForSpans(count: number): Promise<tracing.ReadableSpan[]> {
  await vi.waitFor(() => expect(exporter.getFinishedSpans().length).toBeGreaterThanOrEqual(count));

  return exporter.getFinishedSpans();
}

const durationMs = (span: tracing.ReadableSpan): number => span.duration[0] * 1000 + span.duration[1] / 1e6;

describe('request tracing', () => {
  test('server span covers the full response, first-byte span ends at the first flush', async () => {
    const url = await startServer((_req, res) => {
      res.write('first chunk');

      setTimeout(() => res.end('rest'), 60);
    });

    await (await fetch(`${url}/streaming`)).text();

    const spans = await waitForSpans(2);
    const serverSpan = spans.find((s) => s.name === 'GET');
    const firstByteSpan = spans.find((s) => s.name === 'response:first-byte');

    expect(serverSpan).toBeDefined();
    expect(firstByteSpan).toBeDefined();

    expect(firstByteSpan?.parentSpanContext?.spanId).toBe(serverSpan?.spanContext().spanId);
    expect(firstByteSpan?.spanContext().traceId).toBe(serverSpan?.spanContext().traceId);

    expect(durationMs(serverSpan!)).toBeGreaterThanOrEqual(60);
    expect(durationMs(firstByteSpan!)).toBeLessThan(durationMs(serverSpan!));

    expect(serverSpan?.attributes['ttfb']).toBeTypeOf('number');
    expect(serverSpan?.attributes['ttfb'] as number).toBeLessThan(60);
    expect(serverSpan?.attributes['http.response.status_code']).toBe(200);
    expect(firstByteSpan?.attributes['http.response.status_code']).toBe(200);
  });

  test('request span is a root span even when the server listens inside another span', async () => {
    const startupSpan = trace.getTracer('test').startSpan('startup');

    const url = await context.with(trace.setSpan(context.active(), startupSpan), () =>
      startServer((_req, res) => res.end('ok')),
    );

    await (await fetch(`${url}/page`)).text();

    startupSpan.end();

    const spans = await waitForSpans(3);
    const serverSpan = spans.find((s) => s.name === 'GET');

    expect(serverSpan?.parentSpanContext).toBeUndefined();
    expect(serverSpan?.spanContext().traceId).not.toBe(startupSpan.spanContext().traceId);
  });

  test('traceparent header parents the request span under the remote trace', async () => {
    const url = await startServer((_req, res) => res.end('ok'));

    const traceId = '11111111111111111111111111111111';
    const remoteSpanId = '2222222222222222';

    await (await fetch(`${url}/page`, { headers: { traceparent: `00-${traceId}-${remoteSpanId}-01` } })).text();

    const spans = await waitForSpans(2);
    const serverSpan = spans.find((s) => s.name === 'GET');

    expect(serverSpan?.spanContext().traceId).toBe(traceId);
    expect(serverSpan?.parentSpanContext?.spanId).toBe(remoteSpanId);
  });

  test('abort before the first byte ends both spans with error status', async () => {
    const url = await startServer(() => {
      // never respond; the client aborts
    });

    const controller = new AbortController();
    const request = fetch(`${url}/hanging`, { signal: controller.signal }).catch(() => undefined);

    setTimeout(() => controller.abort(), 30);

    await request;

    const spans = await waitForSpans(2);
    const serverSpan = spans.find((s) => s.name === 'GET');
    const firstByteSpan = spans.find((s) => s.name === 'response:first-byte');

    expect(serverSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(firstByteSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(firstByteSpan?.status.message).toBe('request aborted');
  });

  test('excluded paths produce no spans', async () => {
    const url = await startServer((_req, res) => res.end('ok'), {
      telemetry: { exclude: [{ prefix: '/skip' }] },
    });

    await (await fetch(`${url}/skip/this`)).text();
    await (await fetch(`${url}/traced`)).text();

    const spans = await waitForSpans(2);

    expect(spans.filter((s) => s.name === 'GET')).toHaveLength(1);
    expect(spans.find((s) => s.name === 'GET')?.attributes['url.path']).toBe('/traced');
  });
});
