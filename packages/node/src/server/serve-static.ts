import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { BaseApp } from 'astro/app';
import send from 'send';
import { COMPRESSIBLE, MIME_TYPES } from './mime.js';

const VARIANTS = [
  { encoding: 'br', suffix: '.br' },
  { encoding: 'gzip', suffix: '.gz' },
] as const;

function negotiateVariant(
  req: IncomingMessage,
  client: string,
  pathname: string,
): { pathname: string; encoding: string } | undefined {
  const accept = req.headers['accept-encoding'];

  if (typeof accept !== 'string') return undefined;

  for (const { encoding, suffix } of VARIANTS) {
    if (!accept.includes(encoding)) continue;

    if (fs.existsSync(path.join(client, `${pathname}${suffix}`))) {
      return { pathname: `${pathname}${suffix}`, encoding };
    }
  }

  return undefined;
}

function hasFileExtension(pathname: string): boolean {
  const last = pathname.split('/').pop();

  return !!last && last.includes('.');
}

function prependForwardSlash(pathname: string): string {
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

function isDirectory(client: string, urlPath: string): boolean {
  const filePath = path.join(client, urlPath);
  const resolved = path.resolve(filePath);
  const resolvedClient = path.resolve(client);

  // path traversal guard
  if (resolved !== resolvedClient && !resolved.startsWith(resolvedClient + path.sep)) {
    return false;
  }

  try {
    return fs.lstatSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Serve files from the client build directory, falling through to `ssr` when
 * no file matches. Handles trailing-slash redirects per the manifest config
 * and marks hashed assets as immutable.
 */
export function createStaticHandler(app: BaseApp, client: string) {
  return (req: IncomingMessage, res: ServerResponse, ssr: () => void): void => {
    if (!req.url) {
      ssr();

      return;
    }

    let fullUrl = req.url;

    if (fullUrl.includes('#')) {
      fullUrl = fullUrl.slice(0, fullUrl.indexOf('#'));
    }

    const [urlPath = '', urlQuery] = fullUrl.split('?');
    let fsPath = app.removeBase(urlPath);

    try {
      fsPath = decodeURI(fsPath);
    } catch {
      // fall through with the raw path; send() rejects malformed paths itself
    }

    const dir = isDirectory(client, fsPath);
    const hasSlash = urlPath.endsWith('/');
    let pathname = urlPath;

    switch (app.manifest.trailingSlash) {
      case 'never': {
        if (dir && urlPath !== '/' && hasSlash) {
          res.statusCode = 301;
          res.setHeader('Location', urlPath.slice(0, -1) + (urlQuery ? `?${urlQuery}` : ''));
          res.end();

          return;
        }

        if (dir && !hasSlash) {
          pathname = `${urlPath}/index.html`;
        }

        break;
      }
      case 'ignore': {
        if (dir && !hasSlash) {
          pathname = `${urlPath}/index.html`;
        }

        break;
      }
      case 'always': {
        if (!hasSlash && !hasFileExtension(urlPath) && !urlPath.startsWith('/_')) {
          res.statusCode = 301;
          res.setHeader('Location', `${urlPath}/${urlQuery ? `?${urlQuery}` : ''}`);
          res.end();

          return;
        }

        break;
      }
    }

    pathname = prependForwardSlash(app.removeBase(pathname));

    const normalizedPathname = path.posix.normalize(pathname);
    const compressible = COMPRESSIBLE.has(path.posix.extname(normalizedPathname));
    const variant = compressible ? negotiateVariant(req, client, normalizedPathname) : undefined;

    const stream = send(req, variant?.pathname ?? normalizedPathname, {
      root: client,
      dotfiles: normalizedPathname.startsWith('/.well-known/') ? 'allow' : 'deny',
      // with build.format 'file' or 'preserve', pages are output as `page.html`
      // instead of `page/index.html` — let send() try appending `.html`
      extensions: app.manifest.buildFormat === 'file' || app.manifest.buildFormat === 'preserve' ? ['html'] : [],
    });

    let forwardError = false;

    stream.on('error', (err: NodeJS.ErrnoException & { statusCode?: number }) => {
      if (forwardError) {
        const status = err.statusCode ?? 500;

        if (status >= 500) {
          console.error(err.toString());
        }

        res.writeHead(status);
        res.end(status >= 500 ? 'Internal server error' : '');

        return;
      }

      ssr();
    });

    stream.on('file', () => {
      forwardError = true;
    });

    // fires before the body and before conditional-GET handling, so these
    // headers also land on 304 responses
    stream.on('headers', (headersRes: ServerResponse) => {
      if (compressible) {
        headersRes.setHeader('Vary', 'Accept-Encoding');
      }

      if (variant) {
        headersRes.setHeader('Content-Encoding', variant.encoding);
        headersRes.setHeader(
          'Content-Type',
          MIME_TYPES.get(path.posix.extname(normalizedPathname)) ?? 'application/octet-stream',
        );
      }

      if (normalizedPathname.startsWith(`/${app.manifest.assetsDir}/`)) {
        headersRes.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    });

    stream.pipe(res);
  };
}
