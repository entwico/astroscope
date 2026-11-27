import fs from 'node:fs';
import { type Server, createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { SpanStatusCode, metrics as metricsApi } from '@opentelemetry/api';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import pino, { type DestinationStream } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { createRequestInstrumentation } from '../observability/instrument';
import { type RequestRecord, getLogStore, getRequestRecord } from '../observability/log/store';
import { registerTestTracing } from '../observability/test-tracing';
import { createAppHandler, writeResponse } from './serve-app';

const spans = new InMemorySpanExporter();
const reader = new PeriodicExportingMetricReader({
  exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
  exportIntervalMillis: 60_000,
});

beforeAll(() => {
  registerTestTracing([new SimpleSpanProcessor({ exporter: spans })]);
  metricsApi.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
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
    }));

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

type Render = (request: Request, options: RenderOptions) => Promise<Response>;
type AppHandler = ReturnType<typeof createAppHandler>;
type RejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

interface RenderOptions {
  prerenderedErrorPageFetch: (url: string) => Promise<Response>;
}

const rejectionListeners: RejectionListener[] = [];

afterEach(() => {
  for (const listener of rejectionListeners.splice(0)) {
    process.off('unhandledRejection', listener);
  }
});

/** the handler over a stub app, with the process listener it installs tracked for removal */
function createHandler(render: Render, client = '/nonexistent'): { handler: AppHandler; onRejection: RejectionListener } {
  const before = new Set(process.listeners('unhandledRejection'));
  const app = { match() {}, render, getAllowedDomains: () => [] };
  const handler = createAppHandler(app as never, { port: 0, bodySizeLimit: 0 } as never, client);
  const onRejection = process.listeners('unhandledRejection').find((listener) => !before.has(listener))!;

  rejectionListeners.push(onRejection);

  return { handler, onRejection };
}

async function listen(listener: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(listener);

  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('createAppHandler', () => {
  test('a rejected render answers 500 instead of leaving the client waiting', async () => {
    getLogStore().root = pino({ base: null }, sink);

    const { handler } = createHandler(() => Promise.reject(new Error('astro gave up')));
    const url = await listen((req, res) => void handler(req, res));

    const response = await fetch(`${url}/page`);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(logLines.find((line) => line['msg'] === 'could not render')).toMatchObject({ url: '/page' });
  });

  test('a render failing once the head is out closes the connection instead of leaving it open', async () => {
    getLogStore().root = pino({ base: null }, sink);

    const { handler } = createHandler(() => Promise.reject(new Error('astro gave up')));
    const url = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<html>partial');

      void handler(req, res);
    });

    const response = await fetch(`${url}/page`);

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();
    expect(logLines.find((line) => line['msg'] === 'could not render')).toMatchObject({ url: '/page' });
  });

  test('a request that cannot become a web request answers 500 without reaching the render', async () => {
    getLogStore().root = pino({ base: null }, sink);

    const render = vi.fn<Render>();
    const { handler } = createHandler(render);
    const url = await listen((req, res) => void handler(req, res));
    const { hostname, port } = new URL(url);

    // the fetch standard forbids the method, so `new Request()` throws on it
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ hostname, port, path: '/page', method: 'TRACE' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });

      req.on('error', reject);
      req.end();
    });

    expect(status).toBe(405);
    expect(render).not.toHaveBeenCalled();
    expect(logLines.find((line) => line['msg'] === 'could not render')).toBeUndefined();
  });
});

describe('unhandled rejections', () => {
  function createRecord(url: string): RequestRecord {
    return { logger: undefined, url, method: 'GET', route: undefined, routeOverride: false, actionName: undefined, truncated: false };
  }

  test('are logged with the url of the request they surfaced in', () => {
    getLogStore().root = pino({ base: null }, sink);

    const { onRejection } = createHandler(() => Promise.resolve(new Response('ok')));

    getLogStore().requestStorage.run(createRecord('/cart?step=2'), () => {
      onRejection(new Error('forgotten await'), Promise.resolve());
    });

    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toMatchObject({
      level: 50,
      msg: 'unhandled rejection while rendering',
      url: '/cart?step=2',
      err: { message: 'forgotten await' },
    });
  });

  test('are logged without a url outside of a request, a non-error reason as it is', () => {
    getLogStore().root = pino({ base: null }, sink);

    const { onRejection } = createHandler(() => Promise.resolve(new Response('ok')));

    onRejection('timer gave up', Promise.resolve());

    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toMatchObject({ level: 50, msg: 'unhandled rejection', reason: 'timer gave up' });
    expect(logLines[0]).not.toHaveProperty('url');
  });
});

describe('prerendered error pages', () => {
  let client: string;

  beforeAll(() => {
    client = fs.mkdtempSync(path.join(os.tmpdir(), 'astroscope-serve-app-'));

    fs.mkdirSync(path.join(client, '500'));
    fs.writeFileSync(path.join(client, '404.html'), 'prerendered 404');
    fs.writeFileSync(path.join(client, '500', 'index.html'), 'prerendered 500');
  });

  afterAll(() => {
    fs.rmSync(client, { recursive: true, force: true });
  });

  /** what astro gets when it asks the adapter for its prerendered error page */
  async function fetchErrorPage(
    pageUrl: string,
    clientDir = client,
  ): Promise<{ status: number; type: string | null; body: string }> {
    const { handler } = createHandler((_request, options) => options.prerenderedErrorPageFetch(pageUrl), clientDir);
    const url = await listen((req, res) => void handler(req, res));
    const response = await fetch(`${url}/anything`);

    return { status: response.status, type: response.headers.get('content-type'), body: await response.text() };
  }

  test('are read from the client dir instead of being fetched over http', async () => {
    expect(await fetchErrorPage('http://localhost/404.html')).toEqual({
      status: 200,
      type: 'text/html; charset=utf-8',
      body: 'prerendered 404',
    });
  });

  test('are found in either build format, whichever spelling astro asks for', async () => {
    expect(await fetchErrorPage('http://localhost/404/index.html')).toMatchObject({ body: 'prerendered 404' });
    expect(await fetchErrorPage('http://localhost/500.html')).toMatchObject({ body: 'prerendered 500' });
    expect(await fetchErrorPage('http://localhost/base/500/index.html')).toMatchObject({ body: 'prerendered 500' });
  });

  test('answer 404 when the page was never prerendered', async () => {
    expect(await fetchErrorPage('http://localhost/404.html', path.join(client, 'missing'))).toMatchObject({
      status: 404,
      body: '',
    });
  });

  test('never serve another file of the client dir', async () => {
    fs.writeFileSync(path.join(client, 'other.html'), 'another page');

    expect(await fetchErrorPage('http://localhost/other.html')).toMatchObject({ status: 404, body: '' });
  });
});

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

  test('a response with neither headers nor a body is written as it is', async () => {
    const url = await startServer(() => new Response(null, { status: 204 }));

    const response = await fetch(url);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
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
