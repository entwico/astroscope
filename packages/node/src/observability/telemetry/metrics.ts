import { type Histogram, type UpDownCounter, ValueType, metrics } from '@opentelemetry/api';

const LIB_NAME = '@astroscope/node';

// lazy initialization so instruments bind to the SDK meter provider
let httpRequestDuration: Histogram | null = null;
let httpActiveRequests: UpDownCounter | null = null;
let actionDuration: Histogram | null = null;

function getHttpRequestDuration(): Histogram {
  return (httpRequestDuration ??= metrics.getMeter(LIB_NAME).createHistogram('http.server.request.duration', {
    description: 'Duration of HTTP server requests',
    unit: 's',
    valueType: ValueType.DOUBLE,
  }));
}

function getHttpActiveRequests(): UpDownCounter {
  return (httpActiveRequests ??= metrics.getMeter(LIB_NAME).createUpDownCounter('http.server.active_requests', {
    description: 'Number of active HTTP server requests',
    unit: '{request}',
    valueType: ValueType.INT,
  }));
}

function getActionDuration(): Histogram {
  return (actionDuration ??= metrics.getMeter(LIB_NAME).createHistogram('astro.action.duration', {
    description: 'Duration of Astro action executions',
    unit: 's',
    valueType: ValueType.DOUBLE,
  }));
}

/**
 * Record the start of an HTTP request. Returns a function to call when the
 * request ends. Route is unknown at the native-handler level, so active
 * requests carry only the method.
 */
export function recordHttpRequestStart(method: string): () => void {
  getHttpActiveRequests().add(1, { 'http.request.method': method });

  return () => {
    getHttpActiveRequests().add(-1, { 'http.request.method': method });
  };
}

export function recordHttpRequestDuration(
  attributes: { method: string; route: string | undefined; status: number },
  durationMs: number,
): void {
  getHttpRequestDuration().record(durationMs / 1000, {
    'http.request.method': attributes.method,
    'http.route': attributes.route ?? '',
    'http.response.status_code': attributes.status,
  });
}

export function recordActionDuration(attributes: { name: string; status: number }, durationMs: number): void {
  getActionDuration().record(durationMs / 1000, {
    'astro.action.name': attributes.name,
    'http.response.status_code': attributes.status,
  });
}
