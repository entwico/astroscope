import { DURATION_BUCKETS, createCounter, createHistogram, createUpDownCounter } from './telemetry.js';

const httpRequestDuration = createHistogram('http.server.request.duration', {
  description: 'Duration of HTTP server requests',
  unit: 's',
  buckets: DURATION_BUCKETS.http,
});

const httpActiveRequests = createUpDownCounter('http.server.active_requests', {
  description: 'Number of active HTTP server requests',
  unit: '{request}',
});

const actionDuration = createHistogram('astro.action.duration', {
  description: 'Duration of Astro action executions',
  unit: 's',
  buckets: DURATION_BUCKETS.http,
});

const renderFailures = createCounter('astro.render.failures', {
  description: 'Responses that failed while streaming, after the status was sent',
  unit: '{response}',
});

/**
 * Record the start of an HTTP request. Returns a function to call when the
 * request ends. Route is unknown at the native-handler level, so active
 * requests carry only the method.
 */
export function recordHttpRequestStart(method: string): () => void {
  httpActiveRequests.add(1, { 'http.request.method': method });

  return () => {
    httpActiveRequests.add(-1, { 'http.request.method': method });
  };
}

export function recordHttpRequestDuration(
  attributes: { method: string; route: string | undefined; status: number },
  durationMs: number,
): void {
  httpRequestDuration.record(durationMs / 1000, {
    'http.request.method': attributes.method,
    'http.route': attributes.route ?? '',
    'http.response.status_code': attributes.status,
  });
}

export function recordActionDuration(attributes: { name: string; status: number }, durationMs: number): void {
  actionDuration.record(durationMs / 1000, {
    'astro.action.name': attributes.name,
    'http.response.status_code': attributes.status,
  });
}

export function recordRenderFailure(route: string | undefined): void {
  renderFailures.add(1, { 'http.route': route ?? '' });
}
