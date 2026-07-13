import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMatcher } from '@entwico/dash/match';
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import type { Logger } from 'pino';
import type { ExcludePattern } from '../excludes/excludes.js';
import { generateReqId } from './log/index.js';
import { type RequestRecord, getLogStore } from './log/store.js';
import { recordActionDuration, recordHttpRequestDuration, recordHttpRequestStart } from './telemetry/metrics.js';

const LIB_NAME = '@astroscope/node';
const ACTIONS_PREFIX = '/_actions/';
const REQUEST_ID_PATTERN = /^[\w.-]{1,64}$/;

const roundTime = (n: number) => Math.round(n * 100) / 100;

export interface RequestLoggingConfig {
  exclude: ExcludePattern[];
  extended: boolean;
}

export interface RequestTelemetryConfig {
  exclude: ExcludePattern[];
}

export interface RequestInstrumentationConfig {
  logging: RequestLoggingConfig | false;
  telemetry: RequestTelemetryConfig | false;
}

function getClientIp(req: IncomingMessage): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;

  return (
    first?.split(',')[0]?.trim() ??
    (req.headers['x-real-ip'] as string | undefined) ??
    (req.headers['cf-connecting-ip'] as string | undefined)
  );
}

function resolveReqId(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;

  return value && REQUEST_ID_PATTERN.test(value) ? value : generateReqId();
}

function chunkSize(chunk: unknown): number {
  if (chunk == null) return 0;
  if (ArrayBuffer.isView(chunk)) return chunk.byteLength;
  if (typeof chunk === 'string') return Buffer.byteLength(chunk);

  return 0;
}

/**
 * Wraps the native request/response with logging and telemetry: a request
 * logger in async context (real status, response size, aborted-vs-completed
 * on `finish`/`close`), a SERVER span with propagation extraction, and
 * request metrics. Both concerns honor their own exclude patterns; when both
 * are excluded the request passes through untouched.
 */
export function createRequestInstrumentation(config: RequestInstrumentationConfig) {
  const tracer = trace.getTracer(LIB_NAME);
  const store = getLogStore();
  const loggingExcluded = config.logging ? createMatcher(config.logging.exclude) : () => true;
  const telemetryExcluded = config.telemetry ? createMatcher(config.telemetry.exclude) : () => true;

  return (req: IncomingMessage, res: ServerResponse, inner: () => void): void => {
    const url = req.url ?? '';
    const queryIndex = url.indexOf('?');
    const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
    const method = req.method ?? 'GET';

    const logging = config.logging && !loggingExcluded(pathname) ? config.logging : false;
    const telemetry = config.telemetry && !telemetryExcluded(pathname) ? config.telemetry : false;

    if (!logging && !telemetry) {
      inner();

      return;
    }

    const startTime = performance.now();
    const isAction = pathname.startsWith(ACTIONS_PREFIX);

    let requestLogger: Logger | undefined;

    if (logging && store.root) {
      const reqId = resolveReqId(req);
      const reqData: Record<string, unknown> = { method, url: pathname };

      // extended logging includes potentially sensitive data
      if (logging.extended) {
        reqData['query'] = queryIndex === -1 ? '' : url.slice(queryIndex + 1);
        reqData['headers'] = req.headers;
        reqData['remoteAddress'] = getClientIp(req) ?? req.socket.remoteAddress;
      }

      requestLogger = store.root.child({ reqId, req: reqData });

      res.setHeader('x-request-id', reqId);
    }

    const record: RequestRecord = {
      logger: requestLogger,
      url,
      route: undefined,
      actionName: isAction ? pathname.slice(ACTIONS_PREFIX.length).replace(/\/$/, '') : undefined,
    };

    let span: ReturnType<typeof tracer.startSpan> | undefined;
    let firstByteSpan: ReturnType<typeof tracer.startSpan> | undefined;
    let endActiveRequest: (() => void) | undefined;

    if (telemetry) {
      const parentContext = propagation.extract(ROOT_CONTEXT, req.headers);
      const contentLength = req.headers['content-length'];
      const clientIp = getClientIp(req);
      const host = req.headers['host'];

      span = tracer.startSpan(
        isAction ? `ACTION ${record.actionName}` : method,
        {
          kind: SpanKind.SERVER,
          attributes: {
            'http.request.method': method,
            'url.path': pathname,
            'url.query': queryIndex === -1 ? '' : url.slice(queryIndex + 1),
            'url.scheme': 'http',
            'user_agent.original': req.headers['user-agent'] ?? '',
            ...(host && { 'server.address': host }),
            ...(contentLength && { 'http.request.body.size': parseInt(contentLength) }),
            ...(clientIp && { 'client.address': clientIp }),
          },
        },
        parentContext,
      );

      firstByteSpan = tracer.startSpan('response:first-byte', undefined, trace.setSpan(parentContext, span));

      endActiveRequest = recordHttpRequestStart(method);
    }

    let responseSize = 0;
    let firstByteTime: number | undefined;

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    const markFirstByte = (): void => {
      if (firstByteTime !== undefined) return;

      firstByteTime = performance.now();

      if (firstByteSpan) {
        firstByteSpan.setAttribute('http.response.status_code', res.statusCode);
        firstByteSpan.end();
      }
    };

    res.write = ((chunk: unknown, ...rest: unknown[]) => {
      markFirstByte();
      responseSize += chunkSize(chunk);

      return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof res.write;

    res.end = ((chunk: unknown, ...rest: unknown[]) => {
      markFirstByte();
      responseSize += chunkSize(chunk);

      return (originalEnd as (...args: unknown[]) => ServerResponse)(chunk, ...rest);
    }) as typeof res.end;

    let finalized = false;

    const finalize = (aborted: boolean): void => {
      if (finalized) return;

      finalized = true;

      const status = res.statusCode;
      const responseTime = performance.now() - startTime;
      const ttfb = roundTime((firstByteTime ?? performance.now()) - startTime);

      if (requestLogger) {
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

        requestLogger[level](
          {
            res: { statusCode: status },
            responseTime: roundTime(responseTime),
            ttfb,
            responseSize,
            ...(record.route && { route: record.route }),
            ...(aborted && { aborted: true }),
          },
          aborted ? 'request aborted' : 'request completed',
        );
      }

      if (firstByteSpan && firstByteTime === undefined) {
        firstByteSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'request aborted' });
        firstByteSpan.end();
      }

      if (span) {
        span.setAttribute('http.response.status_code', status);
        span.setAttribute('http.response.body.size', responseSize);
        span.setAttribute('ttfb', ttfb);

        if (aborted || status >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: aborted ? 'request aborted' : `HTTP ${status}` });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        span.end();
      }

      if (telemetry) {
        endActiveRequest?.();
        recordHttpRequestDuration({ method, route: record.route, status }, responseTime);

        if (record.actionName) {
          recordActionDuration({ name: record.actionName, status }, responseTime);
        }
      }
    };

    res.once('finish', () => finalize(false));
    res.once('close', () => finalize(!res.writableFinished));

    const run = (): void => store.requestStorage.run(record, inner);

    if (span) {
      context.with(trace.setSpan(context.active(), span), run);
    } else {
      run();
    }
  };
}
