import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { BaseApp } from 'astro/app';
import { createRequestFromNodeRequest, writeResponse } from 'astro/app/node';
import { log } from '../observability/log/index.js';
import { getRequestRecord } from '../observability/log/store.js';
import type { RuntimeOptions } from '../types.js';

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

    const response =
      routeData && !(routeData.type === 'page' && routeData.prerender)
        ? await app.render(request, { addCookieHeader: true, routeData, prerenderedErrorPageFetch })
        : await app.render(request, { addCookieHeader: true, prerenderedErrorPageFetch });

    await writeResponse(response, res);
  };
}
