// a stand-in for the cap standalone service: speaks its three endpoints, hands out challenges,
// accepts any solution on redeem and verifies each token once. runnable on its own (`pnpm stub`)
// and started in-process by the tests
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TOKEN_LIFETIME_MS = 10 * 60_000;

export function startCapStub({ port = 14363, siteKey = 'demo', secretKey = 'demo-secret' } = {}) {
  const challenges = new Set();
  const tokens = new Set();
  const calls = [];

  const server = createServer(async (req, res) => {
    const [, key, endpoint] = req.url.split('/');
    const body = await readJson(req);

    calls.push({ endpoint, headers: req.headers });

    if (req.method !== 'POST' || key !== siteKey) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));

      return;
    }

    if (endpoint === 'challenge') {
      const token = randomBytes(8).toString('hex');

      challenges.add(token);
      json(res, 200, { challenge: { c: 2, s: 16, d: 2 }, token, expires: Date.now() + TOKEN_LIFETIME_MS });

      return;
    }

    if (endpoint === 'redeem') {
      if (!challenges.delete(body?.token) || !Array.isArray(body?.solutions)) {
        json(res, 400, { success: false, error: 'invalid challenge' });

        return;
      }

      const token = `cap-${randomBytes(12).toString('hex')}`;

      tokens.add(token);
      json(res, 200, { success: true, token, expires: Date.now() + TOKEN_LIFETIME_MS });

      return;
    }

    if (endpoint === 'siteverify') {
      if (typeof body?.secret !== 'string' || typeof body?.response !== 'string') {
        json(res, 400, { success: false, error: 'Missing required parameters' });

        return;
      }

      json(res, 200, { success: body.secret === secretKey && tokens.delete(body.response) });

      return;
    }

    json(res, 404, { error: 'not found' });
  });

  const listening = new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(undefined)));

  return {
    listening,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) chunks.push(chunk);

  const text = Buffer.concat(chunks).toString();

  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env['PORT'] ?? 14363);
  const stub = startCapStub({ port });

  await stub.listening;

  console.log(`cap stub listening on http://localhost:${port} (site key "demo", secret "demo-secret")`);
}
