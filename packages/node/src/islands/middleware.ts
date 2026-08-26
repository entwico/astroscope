import type { MiddlewareHandler } from 'astro';
import { log } from '../observability/log/index.js';
import { getRequestRouteData } from '../server/route-store.js';
import { getDocumentEmitters } from './emitters.js';
import { type IslandsTransformer, createIslandsTransformer, createPageTransformStream } from './transform.js';
import type { IslandsManifest } from './types.js';

/**
 * Streams every html page response through the delivery pipeline: the islands
 * rewriter (when a manifest exists — prod with preloading enabled) plus the
 * document emissions registered by other packages, head scripts inserted after
 * `<head>` and end scripts appended once the rewriter finished. Non-page routes
 * (an endpoint or proxy catch-all returning html), non-html responses and
 * already-encoded bodies pass through untouched. Injected bytes invalidate a
 * pre-computed length, so `content-length` is dropped — streamed responses never
 * carry one anyway.
 */
export function createIslandsMiddleware(manifest: IslandsManifest | null): MiddlewareHandler {
  let transformer: IslandsTransformer | undefined;

  return async (context, next) => {
    const response = await next();
    const emitters = getDocumentEmitters();

    if (!manifest && emitters.length === 0) {
      return response;
    }

    const route = getRequestRouteData(context.request);

    if (route && route.type !== 'page') {
      return response;
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (
      !response.body ||
      !contentType.toLowerCase().includes('text/html') ||
      response.headers.has('content-encoding')
    ) {
      return response;
    }

    const heads: string[] = [];
    const ends: (() => string | null)[] = [];

    for (const emitter of emitters) {
      try {
        const emission = emitter(context);

        if (emission?.head) {
          heads.push(emission.head);
        }

        if (emission?.end) {
          ends.push(emission.end);
        }
      } catch (error) {
        // an emitter must never break the page — its contribution is dropped
        log.error({ err: error }, 'document emitter failed');
      }
    }

    if (!manifest && heads.length === 0 && ends.length === 0) {
      return response;
    }

    if (manifest) {
      transformer ??= createIslandsTransformer(manifest);
    }

    const stream = createPageTransformStream({
      rewriter: transformer?.createDocumentRewriter(context),
      heads,
      ends,
    });

    const headers = new Headers(response.headers);

    headers.delete('content-length');

    return new Response(response.body.pipeThrough(stream), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
