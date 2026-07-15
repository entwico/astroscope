import { type Span, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { type RequestRecord, getLogStore } from './log/store';
import { overrideRequestRoute, setRequestRoute } from './request-route';

const STORE_KEY = Symbol.for('@astroscope/node/log');

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
  vi.restoreAllMocks();
});

function requestRecord(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    logger: undefined,
    url: '/',
    method: 'GET',
    route: undefined,
    routeOverride: false,
    actionName: undefined,
    ...overrides,
  };
}

function inRequest(record: RequestRecord, fn: () => void): void {
  getLogStore().requestStorage.run(record, fn);
}

function mockSpan(): { name: () => string | undefined; attributes: Record<string, unknown> } {
  let name: string | undefined;
  const attributes: Record<string, unknown> = {};

  const span = {
    isRecording: () => true,
    updateName: (value: string) => {
      name = value;
    },
    setAttribute: (key: string, value: unknown) => {
      attributes[key] = value;
    },
  } as unknown as Span;

  vi.spyOn(trace, 'getActiveSpan').mockReturnValue(span);

  return { name: () => name, attributes };
}

describe('overrideRequestRoute', () => {
  test('records the route on the request record', () => {
    const record = requestRecord();

    inRequest(record, () => overrideRequestRoute('/cms/pages/[id]'));

    expect(record.route).toBe('/cms/pages/[id]');
    expect(record.routeOverride).toBe(true);
  });

  test('overrides a route already stamped by routing', () => {
    const record = requestRecord({ route: '/404' });

    inRequest(record, () => overrideRequestRoute('/cms/pages/[id]'));

    expect(record.route).toBe('/cms/pages/[id]');
  });

  test('wins over a later routing stamp', () => {
    const record = requestRecord();

    inRequest(record, () => {
      overrideRequestRoute('/cms/pages/[id]');
      setRequestRoute('/404', 'GET');
    });

    expect(record.route).toBe('/cms/pages/[id]');
  });

  test('names the span with the record method', () => {
    const { name, attributes } = mockSpan();

    inRequest(requestRecord({ method: 'POST' }), () => overrideRequestRoute('/cms/pages/[id]'));

    expect(attributes['http.route']).toBe('/cms/pages/[id]');
    expect(name()).toBe('POST /cms/pages/[id]');
  });

  test('leaves an action span name untouched', () => {
    const { name } = mockSpan();

    inRequest(requestRecord({ actionName: 'checkout' }), () => overrideRequestRoute('/cms/pages/[id]'));

    expect(name()).toBeUndefined();
  });

  test('does not throw outside a request context', () => {
    expect(() => overrideRequestRoute('/cms/pages/[id]')).not.toThrow();
  });
});

describe('setRequestRoute', () => {
  test('records the route on the request record', () => {
    const record = requestRecord();

    inRequest(record, () => setRequestRoute('/blog/[slug]', 'GET'));

    expect(record.route).toBe('/blog/[slug]');
    expect(record.routeOverride).toBe(false);
  });

  test('lands the rewrite target when routing runs again', () => {
    const record = requestRecord();
    const { name } = mockSpan();

    inRequest(record, () => {
      setRequestRoute('/blog/[slug]', 'GET');
      setRequestRoute('/archive/[year]', 'GET');
    });

    expect(record.route).toBe('/archive/[year]');
    expect(name()).toBe('GET /archive/[year]');
  });

  test('leaves record and span untouched once the route is overridden', () => {
    const { name } = mockSpan();
    const record = requestRecord({ route: '/cms/pages/[id]', routeOverride: true });

    inRequest(record, () => setRequestRoute('/404', 'GET'));

    expect(record.route).toBe('/cms/pages/[id]');
    expect(name()).toBeUndefined();
  });
});
