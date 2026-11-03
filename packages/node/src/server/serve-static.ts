import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { BaseApp } from 'astro/app';
import send from 'send';
import { overrideRequestRoute } from '../observability/request-route.js';
import { COMPRESSIBLE, MIME_TYPES } from './mime.js';

const VARIANTS = [
  { encoding: 'br', suffix: '.br' },
  { encoding: 'gzip', suffix: '.gz' },
] as const;

/** the weight of every coding listed in an `accept-encoding` header; an unparsable q counts as 0 */
function parseAcceptEncoding(header: string): Map<string, number> {
  const weights = new Map<string, number>();

  for (const entry of header.split(',')) {
    const [coding = '', ...params] = entry.split(';').map((part) => part.trim().toLowerCase());

    if (!coding) continue;

    const q = params.find((param) => param.startsWith('q='));
    const weight = q === undefined ? 1 : Number(q.slice(2));

    weights.set(coding, Number.isFinite(weight) ? weight : 0);
  }

  return weights;
}

function negotiateVariant(
  req: IncomingMessage,
  client: string,
  file: string,
): { pathname: string; encoding: string } | undefined {
  const accept = req.headers['accept-encoding'];

  if (typeof accept !== 'string') return undefined;

  const weights = parseAcceptEncoding(accept);
  const candidates = VARIANTS.map((variant, order) => ({
    ...variant,
    order,
    weight: weights.get(variant.encoding) ?? weights.get('*') ?? 0,
  }))
    .filter((candidate) => candidate.weight > 0)
    .toSorted((a, b) => b.weight - a.weight || a.order - b.order);

  for (const { encoding, suffix } of candidates) {
    if (statWithin(client, `${file}${suffix}`)?.isFile()) {
      return { pathname: `${file}${suffix}`, encoding };
    }
  }

  return undefined;
}

function prependForwardSlash(pathname: string): string {
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

/** the decoded, normalized path send() resolves against the client dir; undefined when malformed */
function decodePath(pathname: string): string | undefined {
  try {
    return path.posix.normalize(decodeURIComponent(pathname));
  } catch {
    return undefined;
  }
}

/** stats of a path under the client dir; undefined when missing or outside of it */
function statWithin(client: string, pathname: string): fs.Stats | undefined {
  const filePath = path.join(client, pathname);
  const resolved = path.resolve(filePath);
  const resolvedClient = path.resolve(client);

  // path traversal guard
  if (resolved !== resolvedClient && !resolved.startsWith(resolvedClient + path.sep)) {
    return undefined;
  }

  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}

/** the file send() would pick for a decoded path: the index of a slashed directory, the file itself, or its `.html` */
function resolveFile(client: string, pathname: string, extensions: string[]): string | undefined {
  if (pathname.endsWith('/')) {
    const index = `${pathname}index.html`;

    return statWithin(client, index)?.isFile() ? index : undefined;
  }

  if (statWithin(client, pathname)?.isFile()) {
    return pathname;
  }

  if (path.posix.extname(pathname)) {
    return undefined;
  }

  return extensions.map((extension) => `${pathname}.${extension}`).find((file) => statWithin(client, file)?.isFile());
}

/**
 * Serve files from the client build directory, falling through to `ssr` when
 * no file matches, and mark hashed assets as immutable. Directories are served
 * through their index; the trailing-slash setting is enforced by
 * path-redirects.ts ahead of this handler, which never redirects. The file is
 * resolved up front so a pre-compressed variant can be negotiated for whatever
 * send() would serve, an index or an extension-less page included.
 */
export function createStaticHandler(app: BaseApp, client: string) {
  // with build.format 'file' or 'preserve', pages are output as `page.html`
  // instead of `page/index.html`, so an extension-less url tries `.html`
  const extensions = app.manifest.buildFormat === 'file' || app.manifest.buildFormat === 'preserve' ? ['html'] : [];

  return (req: IncomingMessage, res: ServerResponse, ssr: () => void): void => {
    if (!req.url) {
      ssr();

      return;
    }

    let fullUrl = req.url;

    if (fullUrl.includes('#')) {
      fullUrl = fullUrl.slice(0, fullUrl.indexOf('#'));
    }

    const [urlPath = ''] = fullUrl.split('?', 2);
    let pathname = prependForwardSlash(app.removeBase(urlPath));
    let decoded = decodePath(pathname);

    if (decoded !== undefined && !decoded.endsWith('/') && statWithin(client, decoded)?.isDirectory()) {
      pathname += '/index.html';
      decoded += '/index.html';
    }

    const normalizedPathname = path.posix.normalize(pathname);
    // a malformed encoding falls through with the raw path; send() rejects it itself
    const target = decoded ?? normalizedPathname;
    const file = decoded === undefined ? undefined : resolveFile(client, decoded, extensions);
    const compressible = file !== undefined && COMPRESSIBLE.has(path.posix.extname(file));
    const variant = compressible ? negotiateVariant(req, client, file) : undefined;
    const contentType = compressible ? (MIME_TYPES.get(path.posix.extname(file)) ?? 'application/octet-stream') : undefined;

    // the variant is a resolved file, re-encoded for send()'s own decoding
    const stream = send(req, variant ? encodeURI(variant.pathname) : normalizedPathname, {
      root: client,
      dotfiles: target.startsWith('/.well-known/') ? 'allow' : 'deny',
      extensions,
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
      overrideRequestRoute('static');
    });

    // fires before the body and before conditional-GET handling, so these
    // headers also land on 304 responses
    stream.on('headers', (headersRes: ServerResponse) => {
      if (compressible) {
        headersRes.setHeader('Vary', 'Accept-Encoding');
      }

      if (variant && contentType) {
        headersRes.setHeader('Content-Encoding', variant.encoding);
        headersRes.setHeader('Content-Type', contentType);
      }

      if (target.startsWith(`/${app.manifest.assetsDir}/`)) {
        headersRes.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    });

    stream.pipe(res);
  };
}
