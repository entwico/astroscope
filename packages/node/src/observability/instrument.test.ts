import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { node, tracing } from '@opentelemetry/sdk-node';
import pino, { type DestinationStream } from 'pino';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { type RequestInstrumentationConfig, createRequestInstrumentation } from './instrument';
import { getLogStore } from './log/store';

const exporter = new tracing.InMemorySpanExporter();

beforeAll(() => {
  // register() installs the async-hooks context manager and W3C propagators
  new node.NodeTracerProvider({
    spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
  }).register();
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

  exporter.reset();

  logLines.length = 0;
  getLogStore().root = undefined;
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

async function drain(url: string, init?: RequestInit): Promise<void> {
  const res = await fetch(url, init);

  await res.text();
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

    await drain(`${url}/streaming`);

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
      startServer((_req, res) => res.end('ok')));

    await drain(`${url}/page`);

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

    await drain(`${url}/page`, { headers: { traceparent: `00-${traceId}-${remoteSpanId}-01` } });

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
    const request = fetch(`${url}/hanging`, { signal: controller.signal });

    setTimeout(() => controller.abort(), 30);

    try {
      await request;
    } catch {
      // the abort is the point
    }

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

    await drain(`${url}/skip/this`);
    await drain(`${url}/traced`);

    const spans = await waitForSpans(2);

    expect(spans.filter((s) => s.name === 'GET')).toHaveLength(1);
    expect(spans.find((s) => s.name === 'GET')?.attributes['url.path']).toBe('/traced');
  });

  test('action requests are named after the action', async () => {
    const url = await startServer((_req, res) => res.end('{}'));

    await drain(`${url}/_actions/checkout.submit/`, { method: 'POST' });

    const spans = await waitForSpans(2);

    expect(spans.find((s) => s.name === 'ACTION checkout.submit')).toBeDefined();
  });
});

describe('request logging', () => {
  function enableLogging(): void {
    getLogStore().root = pino({ base: null, timestamp: false }, sink);
  }

  async function waitForLog(): Promise<Record<string, unknown>> {
    await vi.waitFor(() => expect(logLines.length).toBeGreaterThanOrEqual(1));

    return logLines[0]!;
  }

  test('logs completion with timing fields and sets x-request-id', async () => {
    enableLogging();

    const url = await startServer(
      (_req, res) => {
        res.write('first chunk');

        setTimeout(() => res.end(Buffer.from('rest')), 20);
      },
      { logging: { exclude: [], extended: false }, telemetry: false },
    );

    const response = await fetch(`${url}/page`);

    await response.text();

    const line = await waitForLog();

    expect(line['msg']).toBe('request completed');
    expect(line['level']).toBe(30);
    expect(line['req']).toEqual({ method: 'GET', url: '/page' });
    expect(line['responseTime']).toBeTypeOf('number');
    expect(line['ttfb']).toBeTypeOf('number');
    expect(line['ttfb'] as number).toBeLessThanOrEqual(line['responseTime'] as number);
    expect(line['responseSize']).toBe(Buffer.byteLength('first chunk') + Buffer.byteLength('rest'));
    expect(line['reqId']).toBe(response.headers.get('x-request-id'));
  });

  test('reuses a valid incoming x-request-id', async () => {
    enableLogging();

    const url = await startServer((_req, res) => res.end('ok'), {
      logging: { exclude: [], extended: false },
      telemetry: false,
    });

    const response = await fetch(`${url}/page`, { headers: { 'x-request-id': 'upstream-id.1' } });

    await response.text();

    const line = await waitForLog();

    expect(line['reqId']).toBe('upstream-id.1');
    expect(response.headers.get('x-request-id')).toBe('upstream-id.1');
  });

  test('logs 4xx as warn and 5xx as error', async () => {
    enableLogging();

    const url = await startServer(
      (req, res) => {
        res.statusCode = req.url === '/missing' ? 404 : 500;

        res.end();
      },
      { logging: { exclude: [], extended: false }, telemetry: false },
    );

    await drain(`${url}/missing`);
    await drain(`${url}/broken`);

    await vi.waitFor(() => expect(logLines.length).toBe(2));

    const missing = logLines.find((l) => (l['req'] as { url: string }).url === '/missing');
    const broken = logLines.find((l) => (l['req'] as { url: string }).url === '/broken');

    expect(missing?.['level']).toBe(40);
    expect(broken?.['level']).toBe(50);
  });

  test('logs aborted requests', async () => {
    enableLogging();

    const url = await startServer(() => {}, { logging: { exclude: [], extended: false }, telemetry: false });

    const controller = new AbortController();
    const request = fetch(`${url}/hanging`, { signal: controller.signal });

    setTimeout(() => controller.abort(), 30);

    try {
      await request;
    } catch {
      // the abort is the point
    }

    const line = await waitForLog();

    expect(line['msg']).toBe('request aborted');
    expect(line['aborted']).toBe(true);
  });

  test('extended logging includes query, headers and remote address', async () => {
    enableLogging();

    const url = await startServer((_req, res) => res.end('ok'), {
      logging: { exclude: [], extended: true },
      telemetry: false,
    });

    await drain(`${url}/search?q=astro`, { headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } });

    const line = await waitForLog();
    const req = line['req'] as Record<string, unknown>;

    expect(req['query']).toBe('q=astro');
    expect(req['remoteAddress']).toBe('10.0.0.1');
    expect((req['headers'] as Record<string, unknown>)['x-forwarded-for']).toBe('10.0.0.1, 10.0.0.2');
  });
});
