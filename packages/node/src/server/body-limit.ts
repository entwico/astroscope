import type { IncomingMessage, ServerResponse } from 'node:http';
import { overrideRequestRoute } from '../observability/request-route.js';

/**
 * Refuses a request body announced larger than the limit with a 413 before anything reads it,
 * ahead of static serving and astro. Astro's own action and server-island limits only cover
 * those two; a page or an endpoint reading `request.formData()` itself has no ceiling without
 * this. Bodies without `content-length` (chunked) pass here and meet the stream limit the
 * adapter hands astro's request factory, which aborts the read at the same number of bytes.
 * Native mounts own their body and are dispatched before this check.
 *
 * `0` or `Infinity` disables the limit.
 */
export function enforceBodyLimit(req: IncomingMessage, res: ServerResponse, limit: number): boolean {
  if (limit === 0 || limit === Infinity) return false;

  const declared = Number(req.headers['content-length']);

  if (!Number.isFinite(declared) || declared <= limit) return false;

  overrideRequestRoute('body-limit');

  // the client keeps sending the body it announced; closing the connection once the answer is out
  // is cheaper than draining it
  res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
  res.end('Request body too large', () => req.socket.destroy());

  return true;
}
