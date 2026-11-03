// a stand-in for the services the demo proxies to: echoes what it received as json, answers a
// redirect, a cookie and a status on request. http/1.1 or, with a certificate, http/2 only.
// started in-process by the tests; `node ./stub/upstream.mjs` serves the http/1.1 one for local runs
import { createServer } from 'node:http';
import { createSecureServer } from 'node:http2';
import { pathToFileURL } from 'node:url';

function handle(req, res) {
  const url = new URL(req.url, 'http://upstream');
  const chunks = [];

  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    const origin = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host ?? req.headers[':authority']}`;

    if (url.pathname === '/redirect') {
      res.writeHead(302, { location: `${origin}/echo` });
      res.end();

      return;
    }

    if (url.pathname === '/cookie') {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'set-cookie': ['session=1; Domain=localhost; Path=/; HttpOnly', 'theme=dark; Path=/'],
      });
      res.end('cookies set');

      return;
    }

    const status = /^\/status\/(\d{3})$/.exec(url.pathname);

    if (status) {
      res.writeHead(Number(status[1]), { 'content-type': 'text/plain' });
      res.end(`status ${status[1]}`);

      return;
    }

    const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !name.startsWith(':')));

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ method: req.method, url: req.url, httpVersion: req.httpVersion, headers, body }));
  });
}

function listen(server, port) {
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    listening,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function startUpstream({ port = 14_395 } = {}) {
  return listen(createServer(handle), port);
}

/** http/2 only, over tls: the proxy's client negotiates h2 by alpn and must speak it */
export function startH2Upstream({ port = 14_396, key, cert }) {
  const server = createSecureServer({ key, cert, allowHTTP1: false });

  server.on('request', handle);

  return listen(server, port);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const upstream = startUpstream();

  await upstream.listening;
  console.log('upstream stub listening on http://127.0.0.1:14395');
}
