import { createReadStream } from 'node:fs';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { BaseApp } from 'astro/app';
import { createRequestFromNodeRequest, getAbortControllerCleanup } from 'astro/app/node';
import { log } from '../observability/log/index.js';
import { getRequestRecord } from '../observability/log/store.js';
import type { RuntimeOptions } from '../types.js';
import { setRequestRouteData } from './route-store.js';

async function readFSErrorPage(client: string, status: number): Promise<Response | undefined> {
  const filePaths = [`${status}.html`, `${status}/index.html`];

  for (const filePath of filePaths) {
    const fullPath = path.join(client, filePath);
    let stream: ReturnType<typeof createReadStream> | undefined;

    try {
      stream = createReadStream(fullPath);

      await new Promise<void>((resolve, reject) => {
        stream!.once('open', () => resolve());
        stream!.once('error', reject);
      });

      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch {
      stream?.destroy();
    }
  }

  return undefined;
}

function createOutgoingHttpHeaders(headers: Headers): OutgoingHttpHeaders | undefined {
  const nodeHeaders: OutgoingHttpHeaders = Object.fromEntries(headers.entries());

  if (Object.keys(nodeHeaders).length === 0) {
    return undefined;
  }

  // the entries iterator joins set-cookie values with a comma; node needs them as an array
  const cookies = headers.getSetCookie();

  if (cookies.length > 1) {
    nodeHeaders['set-cookie'] = cookies;
  }

  return nodeHeaders;
}

/**
 * Streams the web response into the node response. A render failing after the
 * first chunk cannot change the status anymore, so it is logged through the
 * request logger and marked on the request record — the completion line, the
 * span and `astro.render.failures` reflect it. On the wire it behaves like
 * astro's own writer: an `Internal server error` marker, then the socket is
 * destroyed.
 */
export async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusMessage = response.statusText;
  res.writeHead(response.status, createOutgoingHttpHeaders(response.headers));

  // astro parks the socket listener behind the request's abort signal on the node
  // request; releasing it once the response is done keeps keep-alive sockets from
  // accumulating one listener per request
  const cleanupAbort = getAbortControllerCleanup(res.req);

  if (cleanupAbort) {
    const runCleanup = (): void => {
      cleanupAbort();
      res.off('finish', runCleanup);
      res.off('close', runCleanup);
    };

    res.on('finish', runCleanup);
    res.on('close', runCleanup);
  }

  if (!response.body) {
    res.end();

    return;
  }

  const reader = response.body.getReader();

  // a client going away stops the render; on a failed stream the cancel rejects
  // with the render error, which the catch below has already reported
  res.on('close', () => {
    reader.cancel().catch(() => undefined);
  });

  try {
    for (let result = await reader.read(); !result.done; result = await reader.read()) {
      res.write(result.value);
    }

    res.end();
  } catch (err) {
    const record = getRequestRecord();

    if (record) {
      record.truncated = true;
    }

    log.error(
      {
        ...(err instanceof Error ? { err } : { reason: err }),
        ...(record?.route && { route: record.route }),
        ...(!record?.logger && { url: record?.url ?? res.req.url }),
      },
      'render failed after the response started, response truncated',
    );

    res.write('Internal server error', () => {
      res.destroy(err instanceof Error ? err : undefined);
    });
  }
}

/**
 * Render on-demand routes: node req → web Request → `app.render()` → node res.
 * Prerendered pages never reach this handler (the static handler serves them);
 * requests for them landing here render the 404 route.
 */
export function createAppHandler(app: BaseApp, options: RuntimeOptions, client: string) {
  process.on('unhandledRejection', (reason) => {
    const requestUrl = getRequestRecord()?.url;

    log.error(
      {
        ...(reason instanceof Error ? { err: reason } : { reason }),
        ...(requestUrl && { url: requestUrl }),
      },
      requestUrl ? 'unhandled rejection while rendering' : 'unhandled rejection',
    );
  });

  const prerenderedErrorPageFetch = async (url: string): Promise<Response> => {
    const { pathname } = new URL(url);

    for (const status of [404, 500]) {
      if (pathname.endsWith(`/${status}.html`) || pathname.endsWith(`/${status}/index.html`)) {
        const response = await readFSErrorPage(client, status);

        if (response) return response;
      }
    }

    return new Response(null, { status: 404 });
  };

  const bodySizeLimit =
    options.bodySizeLimit === 0 || options.bodySizeLimit === Number.POSITIVE_INFINITY
      ? undefined
      : options.bodySizeLimit;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let request: Request;

    try {
      request = createRequestFromNodeRequest(req, {
        allowedDomains: app.getAllowedDomains?.() ?? [],
        ...(bodySizeLimit !== undefined && { bodySizeLimit }),
        port: options.port,
      });
    } catch (err) {
      log.error(err instanceof Error ? { err, url: req.url } : { reason: err, url: req.url }, 'could not render');

      res.statusCode = 500;
      res.end('Internal Server Error');

      return;
    }

    const routeData = app.match(request, true);
    const matched = routeData && !(routeData.type === 'page' && routeData.prerender) ? routeData : undefined;

    // the one object astro keeps for the whole request, whatever rewrites replace `context.request` with
    const locals = {};

    if (matched) {
      setRequestRouteData(request, locals, matched);
    }

    const response = matched
      ? await app.render(request, { addCookieHeader: true, locals, routeData: matched, prerenderedErrorPageFetch })
      : await app.render(request, { addCookieHeader: true, locals, prerenderedErrorPageFetch });

    await writeResponse(response, res);
  };
}
