import pino, { type DestinationStream, type Logger } from 'pino';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { EARLY_LOG_BUFFER_CAP, type RequestRecord, getLogStore } from './store';
import type { LogProxy } from './index';

const STORE_KEY = Symbol.for('@astroscope/node/log');

const logLines: Record<string, unknown>[] = [];

const sink: DestinationStream = {
  write: (msg: string) => {
    logLines.push(JSON.parse(msg) as Record<string, unknown>);
  },
};

// the proxy captures the store at module evaluation, so each test gets a fresh
// store and a freshly evaluated module
async function freshLogModule(): Promise<{ log: LogProxy; generateReqId: () => string }> {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
  vi.resetModules();

  return import('./index');
}

function sinkLogger(): Logger {
  return pino({ base: null, timestamp: false }, sink);
}

function requestRecord(logger: Logger): RequestRecord {
  return { logger, url: '/x', route: undefined, actionName: undefined };
}

afterEach(() => {
  logLines.length = 0;
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
});

describe('early log buffering', () => {
  test('buffers entries before the root logger exists', async () => {
    const { log } = await freshLogModule();
    const before = Date.now();

    log.info({ step: 1 }, 'starting up');

    const store = getLogStore();

    expect(store.buffer).toHaveLength(1);
    expect(store.buffer[0]).toMatchObject({ level: 'info', bindings: [], args: [{ step: 1 }, 'starting up'] });
    expect(store.buffer[0]?.time).toBeGreaterThanOrEqual(before);
    expect(logLines).toEqual([]);
  });

  test('buffers accumulated child bindings alongside the entry', async () => {
    const { log } = await freshLogModule();

    log.child({ component: 'db' }).child({ attempt: 2 }).error('connection failed');

    const store = getLogStore();

    expect(store.buffer[0]).toMatchObject({
      level: 'error',
      bindings: [{ component: 'db' }, { attempt: 2 }],
      args: ['connection failed'],
    });
  });

  test('drops entries beyond the buffer cap and counts them', async () => {
    const { log } = await freshLogModule();

    for (let i = 0; i < EARLY_LOG_BUFFER_CAP + 2; i++) {
      log.info(`entry ${i}`);
    }

    const store = getLogStore();

    expect(store.buffer).toHaveLength(EARLY_LOG_BUFFER_CAP);
    expect(store.dropped).toBe(2);
  });

  test('a proxy created before construction logs through the root once it exists', async () => {
    const { log } = await freshLogModule();
    const child = log.child({ component: 'db' });

    child.info('buffered');

    getLogStore().root = sinkLogger();

    child.info('live');

    expect(getLogStore().buffer).toHaveLength(1);
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toMatchObject({ msg: 'live', component: 'db', level: 30 });
  });
});

describe('log proxy routing', () => {
  test('logs through the root logger with merged child bindings', async () => {
    const { log } = await freshLogModule();

    getLogStore().root = sinkLogger();

    log.warn({ userId: 7 }, 'root entry');
    log.child({ component: 'db' }).error('bound entry');

    expect(logLines[0]).toMatchObject({ level: 40, msg: 'root entry', userId: 7 });
    expect(logLines[1]).toMatchObject({ level: 50, msg: 'bound entry', component: 'db' });
  });

  test('prefers the request-scoped logger over the root logger', async () => {
    const { log } = await freshLogModule();
    const store = getLogStore();
    const root = sinkLogger();

    store.root = root;

    store.requestStorage.run(requestRecord(root.child({ reqId: 'req-1' })), () => {
      log.info('inside request');
    });

    log.info('outside request');

    expect(logLines[0]).toMatchObject({ msg: 'inside request', reqId: 'req-1' });
    expect(logLines[1]).not.toHaveProperty('reqId');
  });

  test('uses the request-scoped logger even before the root logger is constructed', async () => {
    const { log } = await freshLogModule();
    const store = getLogStore();

    store.requestStorage.run(requestRecord(sinkLogger()), () => {
      log.info('request entry');
    });

    expect(store.buffer).toEqual([]);
    expect(logLines[0]).toMatchObject({ msg: 'request entry' });
  });

  test('raw resolves to the current context logger', async () => {
    const { log } = await freshLogModule();
    const store = getLogStore();
    const root = sinkLogger();

    store.root = root;

    expect(log.raw).toBe(root);

    const requestLogger = root.child({ reqId: 'req-1' });

    store.requestStorage.run(requestRecord(requestLogger), () => {
      expect(log.raw).toBe(requestLogger);
    });
  });

  test('root bypasses the request context', async () => {
    const { log } = await freshLogModule();
    const store = getLogStore();
    const root = sinkLogger();

    store.root = root;

    store.requestStorage.run(requestRecord(root.child({ reqId: 'req-1' })), () => {
      expect(log.root).toBe(root);

      log.child({ component: 'db' }).root.info('root entry');
    });

    expect(logLines[0]).toMatchObject({ msg: 'root entry', component: 'db' });
    expect(logLines[0]).not.toHaveProperty('reqId');
  });

  test('raw and root fall back to a plain logger before construction', async () => {
    const { log } = await freshLogModule();

    expect(log.raw.info).toBeTypeOf('function');
    expect(log.root.info).toBeTypeOf('function');
    expect(getLogStore().root).toBeUndefined();
  });
});

describe('generateReqId', () => {
  test('generates short unique hex ids', async () => {
    const { generateReqId } = await freshLogModule();

    const first = generateReqId();
    const second = generateReqId();

    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(second).toMatch(/^[0-9a-f]{8}$/);
    expect(second).not.toBe(first);
  });
});
