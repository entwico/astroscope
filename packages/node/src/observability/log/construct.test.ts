import { context, trace } from '@opentelemetry/api';
import { node } from '@opentelemetry/sdk-node';
import type { LoggerOptions } from 'pino';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { constructRootLogger, dumpEarlyLogs } from './construct';
import { getLogStore } from './store';

const STORE_KEY = Symbol.for('@astroscope/node/log');

beforeAll(() => {
  // register() installs the async-hooks context manager so trace correlation sees active spans
  new node.NodeTracerProvider().register();
});

const logLines: Record<string, unknown>[] = [];

// the logger is constructed internally from options, so output is captured via the
// streamWrite hook instead of a destination stream; returning '' keeps stdout clean
function captureOptions(extra: LoggerOptions = {}): LoggerOptions {
  return {
    base: null,
    timestamp: false,
    ...extra,
    hooks: {
      streamWrite: (line: string) => {
        logLines.push(JSON.parse(line) as Record<string, unknown>);

        return '';
      },
    },
  };
}

afterEach(() => {
  logLines.length = 0;
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
  vi.restoreAllMocks();
});

describe('constructRootLogger', () => {
  test('constructs a default logger without a factory and stores it as root', async () => {
    const root = await constructRootLogger(undefined, { dev: false });

    expect(root.level).toBe('info');
    expect(getLogStore().root).toBe(root);
  });

  test('accepts plain options', async () => {
    const root = await constructRootLogger(captureOptions({ level: 'debug' }), { dev: false });

    expect(root.level).toBe('debug');

    root.debug('visible');

    expect(logLines[0]).toMatchObject({ msg: 'visible', level: 20 });
  });

  test('awaits a factory function and passes the dev flag', async () => {
    const factory = vi.fn(async () => captureOptions({ level: 'trace' }));

    const root = await constructRootLogger(factory, { dev: true });

    expect(factory).toHaveBeenCalledWith({ dev: true });
    expect(root.level).toBe('trace');
  });

  test('adds trace correlation fields when a span is active', async () => {
    const root = await constructRootLogger(captureOptions(), { dev: false });
    const span = trace.getTracer('test').startSpan('op');

    context.with(trace.setSpan(context.active(), span), () => {
      root.info('inside span');
    });

    span.end();

    root.info('outside span');

    const spanContext = span.spanContext();

    expect(logLines[0]).toMatchObject({
      msg: 'inside span',
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: '01',
    });
    expect(logLines[1]).not.toHaveProperty('trace_id');
  });

  test('composes the user mixin with trace correlation', async () => {
    const root = await constructRootLogger(captureOptions({ mixin: () => ({ app: 'demo' }) }), { dev: false });
    const span = trace.getTracer('test').startSpan('op');

    root.info('plain');

    context.with(trace.setSpan(context.active(), span), () => {
      root.info('correlated');
    });

    span.end();

    expect(logLines[0]).toMatchObject({ msg: 'plain', app: 'demo' });
    expect(logLines[1]).toMatchObject({ app: 'demo', trace_id: span.spanContext().traceId });
  });

  test('replays buffered entries with their bindings and original timestamp', async () => {
    const store = getLogStore();
    const time = Date.UTC(2026, 0, 2, 3, 4, 5);

    store.buffer.push(
      { level: 'info', bindings: [], args: ['early message', 42], time },
      { level: 'error', bindings: [{ component: 'db' }, { attempt: 2 }], args: ['early failure'], time },
    );

    await constructRootLogger(captureOptions(), { dev: false });

    expect(store.buffer).toEqual([]);
    expect(logLines[0]).toMatchObject({
      level: 30,
      msg: 'early message',
      bufferedTime: '2026-01-02T03:04:05.000Z',
    });
    expect(logLines[1]).toMatchObject({
      level: 50,
      msg: 'early failure',
      component: 'db',
      attempt: 2,
      bufferedTime: '2026-01-02T03:04:05.000Z',
    });
  });

  test('warns about dropped entries and resets the counter', async () => {
    getLogStore().dropped = 5;

    await constructRootLogger(captureOptions(), { dev: false });

    expect(logLines[0]).toMatchObject({ level: 40, dropped: 5, msg: 'early log buffer overflowed, entries dropped' });
    expect(getLogStore().dropped).toBe(0);
  });
});

describe('dumpEarlyLogs', () => {
  test('does nothing once the root logger exists', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = getLogStore();

    await constructRootLogger(captureOptions(), { dev: false });

    store.buffer.push({ level: 'info', bindings: [], args: ['late'], time: Date.now() });

    dumpEarlyLogs();

    expect(consoleError).not.toHaveBeenCalled();
    expect(store.buffer).toHaveLength(1);
  });

  test('dumps buffered entries and the dropped count to the console', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = getLogStore();
    const time = Date.UTC(2026, 0, 2, 3, 4, 5);

    store.buffer.push(
      { level: 'info', bindings: [], args: ['plain entry'], time },
      { level: 'error', bindings: [{ component: 'db' }], args: ['bound entry', 7], time },
    );
    store.dropped = 3;

    dumpEarlyLogs();

    expect(consoleError).toHaveBeenNthCalledWith(1, '2026-01-02T03:04:05.000Z', 'INFO', 'plain entry');
    expect(consoleError).toHaveBeenNthCalledWith(
      2,
      '2026-01-02T03:04:05.000Z',
      'ERROR',
      { component: 'db' },
      'bound entry',
      7,
    );
    expect(consoleError).toHaveBeenNthCalledWith(3, '(3 early log entries dropped)');
    expect(store.buffer).toEqual([]);
    expect(store.dropped).toBe(0);
  });
});
