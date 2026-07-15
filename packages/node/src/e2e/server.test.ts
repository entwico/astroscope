import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fixtureRoot, skip } from './fixture';

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);

    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs));
    else out.push(abs);
  }

  return out;
}

const port = 20000 + (process.pid % 10000);
const healthPort = port + 1;
const metricsPort = port + 4;
const baseUrl = `http://127.0.0.1:${port}`;
const healthUrl = `http://127.0.0.1:${healthPort}`;
const metricsUrl = `http://127.0.0.1:${metricsPort}`;

let server: ChildProcess | undefined;
let stdout = '';
let exitCode: number | null | undefined;
const exited = () =>
  new Promise<void>((resolve) => {
    if (!server || exitCode !== undefined) return resolve();

    server.once('exit', () => resolve());
  });

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function rawGet(url: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });

    req.on('error', reject);
  });
}

function logLines(output: string): Record<string, unknown>[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((line): line is Record<string, unknown> => !!line);
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`timed out waiting for ${what}\n--- server output ---\n${stdout}`);
}

describe.skipIf(skip)('e2e — built server runtime', () => {
  beforeAll(async () => {
    rmSync(path.join(fixtureRoot, 'dist'), { recursive: true, force: true });

    const { build } = await import('astro');

    await build({ root: fixtureRoot, logLevel: 'error' });

    server = spawn('node', ['dist/server/entry.mjs'], {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        HEALTH_HOST: '127.0.0.1',
        HEALTH_PORT: String(healthPort),
        OTEL_EXPORTER_PROMETHEUS_HOST: '127.0.0.1',
        OTEL_EXPORTER_PROMETHEUS_PORT: String(metricsPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    server.stdout!.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    server.stderr!.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    server.on('exit', (code) => (exitCode = code));

    await waitFor(async () => (await fetch(`${baseUrl}/`)).ok, 15_000, 'server to listen');
  }, 90_000);

  afterAll(async () => {
    if (server && exitCode === undefined) {
      server.kill('SIGKILL');
      await exited();
    }
  });

  test('onStartup ran with the production context before the port opened', () => {
    // the port only opens after startup completes, so the successful fetch in
    // beforeAll plus this line proves the ordering; ctx=ok additionally proves
    // getBootContext() was stamped with the same context before onStartup ran
    expect(stdout).toContain(`[e2e] startup dev=false host=127.0.0.1 port=${port} ctx=ok config=default`);
  });

  test('renders an on-demand page using state initialized by onStartup', async () => {
    const res = await fetch(`${baseUrl}/`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<p id="state">initialized</p>');
  });

  test('serves endpoints', async () => {
    const res = await fetch(`${baseUrl}/api`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'initialized' });
  });

  test('serves prerendered pages via the static handler', async () => {
    const res = await fetch(`${baseUrl}/static`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('prerendered');
  });

  test('serves public assets', async () => {
    const res = await fetch(`${baseUrl}/hello.txt`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('hello from public');
  });

  test('renders the 404 route for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);

    expect(res.status).toBe(404);
  });

  test('rejects path traversal attempts', async () => {
    const res = await fetch(`${baseUrl}/..%2f..%2fpackage.json`);

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('health probes are up after startup (enabled by default)', async () => {
    for (const probe of ['livez', 'startupz', 'readyz']) {
      const res = await fetch(`${healthUrl}/${probe}`);

      expect(res.status, probe).toBe(200);
    }
  });

  test('health check registered in onStartup is live', async () => {
    const res = await fetch(`${healthUrl}/healthz`);
    const body = (await res.json()) as { status: string; checks: Record<string, { status: string }> };

    expect(body.checks['singleton']?.status).toBe('healthy');
    expect(body.status).toBe('healthy');
  });

  describe('embedded csrf', () => {
    test('rejects cross-origin POST', async () => {
      const res = await fetch(`${baseUrl}/api`, { method: 'POST', headers: { origin: 'https://evil.example' } });

      expect(res.status).toBe(403);
    });

    test('rejects POST without an origin header', async () => {
      const res = await fetch(`${baseUrl}/api`, { method: 'POST' });

      expect(res.status).toBe(403);
    });

    test('allows same-origin POST', async () => {
      const res = await fetch(`${baseUrl}/api`, { method: 'POST', headers: { origin: baseUrl } });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ state: 'initialized', method: 'POST' });
    });

    test('allows excluded paths without an origin header', async () => {
      const res = await fetch(`${baseUrl}/excluded`, { method: 'POST' });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ excluded: true });
    });
  });

  describe('astro preview', () => {
    const previewPort = port + 2;
    const previewUrl = `http://127.0.0.1:${previewPort}`;
    let preview: ChildProcess | undefined;
    let previewOut = '';
    let previewExit: number | null | undefined;

    beforeAll(async () => {
      preview = spawn('node_modules/.bin/astro', ['preview', '--port', String(previewPort), '--host', '127.0.0.1'], {
        cwd: fixtureRoot,
        env: {
          ...process.env,
          HEALTH_HOST: '127.0.0.1',
          HEALTH_PORT: String(port + 3),
          OTEL_EXPORTER_PROMETHEUS_HOST: '127.0.0.1',
          OTEL_EXPORTER_PROMETHEUS_PORT: String(port + 5),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      preview.stdout!.on('data', (chunk: Buffer) => (previewOut += chunk.toString()));
      preview.stderr!.on('data', (chunk: Buffer) => (previewOut += chunk.toString()));
      preview.on('exit', (code) => (previewExit = code));

      await waitFor(async () => (await fetch(`${previewUrl}/`)).ok, 15_000, 'preview server to listen');
    }, 30_000);

    afterAll(async () => {
      if (preview && previewExit === undefined) {
        preview.kill('SIGTERM');

        await new Promise<void>((resolve) => {
          preview!.once('exit', () => resolve());
          setTimeout(() => {
            preview!.kill('SIGKILL');
            resolve();
          }, 5000).unref();
        });
      }
    });

    test('runs the full production path including boot', async () => {
      expect(previewOut).toContain('[e2e] startup dev=false');

      const res = await fetch(`${previewUrl}/`);

      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<p id="state">initialized</p>');
    });
  });

  describe('embedded build tweaks', () => {
    const distClient = path.join(fixtureRoot, 'dist/client');
    const distServer = path.join(fixtureRoot, 'dist/server');
    const CANARY = '__tweaks_canary_marker__';

    test('client bundle has no sourcemaps or sourcemap markers', () => {
      const maps = walkFiles(distClient).filter((f) => f.endsWith('.map'));

      expect(maps, maps.length ? `leaked maps: ${maps.join(', ')}` : '').toEqual([]);

      const offenders = walkFiles(distClient)
        .filter((f) => /\.[mc]?js$/.test(f))
        .filter((f) => readFileSync(f, 'utf8').includes('//# sourceMappingURL='));

      expect(offenders, offenders.length ? `leaked refs: ${offenders.join(', ')}` : '').toEqual([]);
    });

    test('SSR bundle keeps sourcemaps for server stack traces', () => {
      const maps = walkFiles(distServer).filter((f) => f.endsWith('.map'));

      expect(maps.length).toBeGreaterThan(0);
    });

    test('strip-effects removes the SSR useEffect body, client keeps it', () => {
      const ssrOffenders = walkFiles(distServer)
        .filter((f) => /\.m?js$/.test(f))
        .filter((f) => readFileSync(f, 'utf8').includes(CANARY));

      expect(ssrOffenders, ssrOffenders.length ? `canary leaked into SSR: ${ssrOffenders.join(', ')}` : '').toEqual([]);

      const clientHits = walkFiles(distClient)
        .filter((f) => /\.[mc]?js$/.test(f))
        .filter((f) => readFileSync(f, 'utf8').includes(CANARY));

      expect(clientHits.length).toBeGreaterThan(0);
    });
  });

  describe('pre-compressed static serving', () => {
    test('build wrote .br/.gz variants next to the originals', () => {
      expect(existsSync(path.join(fixtureRoot, 'dist/client/hello.txt.br'))).toBe(true);
      expect(existsSync(path.join(fixtureRoot, 'dist/client/hello.txt.gz'))).toBe(true);
      expect(existsSync(path.join(fixtureRoot, 'dist/hyperclient'))).toBe(false);
    });

    test('serves the brotli variant to br-capable clients', async () => {
      const res = await rawGet(`${baseUrl}/hello.txt`, { 'accept-encoding': 'br' });

      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBe('br');
      expect(res.headers['vary']).toBe('Accept-Encoding');
      expect(res.headers['content-type']).toContain('text/plain');
      expect(brotliDecompressSync(res.body).toString()).toContain('hello from public');
    });

    test('serves the gzip variant to gzip-only clients', async () => {
      const res = await rawGet(`${baseUrl}/hello.txt`, { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(res.body).toString()).toContain('hello from public');
    });

    test('serves identity with vary when the client accepts no encoding', async () => {
      const res = await rawGet(`${baseUrl}/hello.txt`);

      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.headers['vary']).toBe('Accept-Encoding');
      expect(res.body.toString()).toContain('hello from public');
    });

    test('negotiates prerendered pages through directory index resolution', async () => {
      const res = await rawGet(`${baseUrl}/static`, { 'accept-encoding': 'br' });

      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBe('br');
      expect(res.headers['content-type']).toContain('text/html');
      expect(brotliDecompressSync(res.body).toString()).toContain('prerendered');
    });

    test('answers conditional requests with 304 per variant', async () => {
      const first = await rawGet(`${baseUrl}/hello.txt`, { 'accept-encoding': 'br' });
      const etag = first.headers['etag'];

      expect(etag).toBeTruthy();

      const second = await rawGet(`${baseUrl}/hello.txt`, { 'accept-encoding': 'br', 'if-none-match': etag! });

      expect(second.status).toBe(304);
      expect(second.headers['vary']).toBe('Accept-Encoding');
    });
  });

  describe('platform entry seams', () => {
    test('config seam ran and its early log was buffered and replayed', async () => {
      await waitFor(() => logLines(stdout).some((line) => line['msg'] === 'config loaded'), 5_000, 'config log');

      const line = logLines(stdout).find((l) => l['msg'] === 'config loaded')!;

      expect(line['value']).toBe('default');
      expect(line['bufferedTime']).toMatch(/^\d{4}-/);
    });

    test('log seam options are applied (base bindings on every line)', () => {
      const line = logLines(stdout).find((l) => l['msg'] === 'config loaded')!;

      expect(line['app']).toBe('node-e2e');
    });

    test('instrumentation seam ran once with the prod context', () => {
      expect(stdout.match(/\[e2e\] instrumentation dev=false/g)).toHaveLength(1);
    });

    test('logs a single server ready line with timings', async () => {
      await waitFor(() => logLines(stdout).some((line) => line['msg'] === 'server ready'), 5_000, 'ready log');

      const ready = logLines(stdout).filter((l) => l['msg'] === 'server ready');

      expect(ready).toHaveLength(1);
      expect(ready[0]).toMatchObject({ host: '127.0.0.1', port, health: true, app: 'node-e2e' });
      expect(ready[0]!['bootMs']).toBeTypeOf('number');
      expect(ready[0]!['warmupMs']).toBeTypeOf('number');
      expect(ready[0]!['totalMs']).toBeTypeOf('number');
    });
  });

  describe('request logging', () => {
    test('logs completed requests with status, size and route', async () => {
      await fetch(`${baseUrl}/`);

      await waitFor(
        () => logLines(stdout).some((l) => l['msg'] === 'request completed' && (l['req'] as any)?.url === '/'),
        5_000,
        'request log',
      );

      const line = logLines(stdout).find(
        (l) => l['msg'] === 'request completed' && (l['req'] as any)?.url === '/',
      ) as any;

      expect(line.req.method).toBe('GET');
      expect(line.res.statusCode).toBe(200);
      expect(line.reqId).toBeTypeOf('string');
      expect(line.responseTime).toBeTypeOf('number');
      expect(line.ttfb).toBeTypeOf('number');
      expect(line.responseSize).toBeGreaterThan(0);
      expect(line.route).toBe('/');
    });

    test('passes an incoming x-request-id through to logs and the response', async () => {
      const res = await fetch(`${baseUrl}/api`, { headers: { 'x-request-id': 'e2e-req-1' } });

      expect(res.headers.get('x-request-id')).toBe('e2e-req-1');

      await waitFor(
        () => logLines(stdout).some((l) => l['reqId'] === 'e2e-req-1' && l['msg'] === 'request completed'),
        5_000,
        'request id log',
      );

      const lines = logLines(stdout).filter((l) => l['reqId'] === 'e2e-req-1');

      // the in-handler log and the completion log share the request context
      expect(lines.some((l) => l['msg'] === 'api handled')).toBe(true);
      expect(lines.some((l) => l['msg'] === 'request completed')).toBe(true);
    });

    test('generates a request id when none is sent', async () => {
      const res = await fetch(`${baseUrl}/api`);

      expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f]{8}$/);
    });

    test('excluded paths produce no request log', async () => {
      await fetch(`${baseUrl}/_astro/missing.css`);
      await fetch(`${baseUrl}/api`);

      await waitFor(
        () => logLines(stdout).filter((l) => l['msg'] === 'request completed').length >= 2,
        5_000,
        'subsequent request log',
      );

      const excludedLines = logLines(stdout).filter((l) => (l['req'] as any)?.url === '/_astro/missing.css');

      expect(excludedLines).toEqual([]);
    });
  });

  describe('telemetry', () => {
    test('serves request metrics on the prometheus port', async () => {
      await fetch(`${baseUrl}/`);

      await waitFor(
        async () => (await (await fetch(`${metricsUrl}/metrics`)).text()).includes('http_server_request_duration'),
        10_000,
        'prometheus metrics',
      );

      const body = await (await fetch(`${metricsUrl}/metrics`)).text();

      expect(body).toContain('http_server_request_duration');
      expect(body).toContain('http_route="/"');
    });
  });

  describe('native mounts', () => {
    test('dispatches matching requests to the native handler with real req/res', async () => {
      const res = await fetch(`${baseUrl}/native/echo?x=1`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body['native']).toBe(true);
      expect(body['method']).toBe('GET');
      expect(body['url']).toBe('/native/echo?x=1');
      // the fake-koa shim could never provide this
      expect(body['remoteAddress']).toBeTruthy();
    });

    test('preserves set-cookie arrays', async () => {
      const res = await fetch(`${baseUrl}/native/echo`);

      expect(res.headers.getSetCookie()).toEqual(['native_a=1', 'native_b=2']);
    });

    test('bypasses csrf — cross-origin POST with a body reaches the handler', async () => {
      const res = await fetch(`${baseUrl}/native/echo`, {
        method: 'POST',
        headers: { origin: 'https://external-oauth-client.example' },
        body: 'grant_type=client_credentials',
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body['method']).toBe('POST');
      expect(body['body']).toBe('grant_type=client_credentials');
    });

    test('longest prefix wins and a throwing handler yields a logged 500', async () => {
      const res = await fetch(`${baseUrl}/native/failing`);

      expect(res.status).toBe(500);

      await waitFor(
        () => logLines(stdout).some((l) => l['msg'] === 'native mount handler failed'),
        5_000,
        'mount error log',
      );
    });

    test('mounted requests are logged with the mount name as route', async () => {
      await waitFor(
        () =>
          logLines(stdout).some(
            (l) =>
              l['msg'] === 'request completed' &&
              (l['req'] as any)?.url === '/native/echo' &&
              l['route'] === 'native-echo',
          ),
        5_000,
        'mount request log',
      );
    });

    test('unmatched paths still fall through to astro', async () => {
      const res = await fetch(`${baseUrl}/api`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ state: 'initialized' });
    });
  });

  describe('env loading order', () => {
    test('boot graph module scope sees env vars loaded from CONFIG_PATH', async () => {
      const envPort = port + 9;
      const envServer = spawn('node', ['dist/server/entry.mjs'], {
        cwd: fixtureRoot,
        env: {
          ...process.env,
          CONFIG_PATH: 'e2e.env',
          HOST: '127.0.0.1',
          PORT: String(envPort),
          HEALTH_HOST: '127.0.0.1',
          HEALTH_PORT: String(port + 10),
          OTEL_EXPORTER_PROMETHEUS_HOST: '127.0.0.1',
          OTEL_EXPORTER_PROMETHEUS_PORT: String(port + 11),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';

      envServer.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()));
      envServer.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));

      try {
        const deadline = Date.now() + 15_000;

        while (!output.includes('[e2e] startup') && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        expect(output).toContain(`[e2e] startup dev=false host=127.0.0.1 port=${envPort} ctx=ok config=from-env-file`);
        expect(logLines(output).find((l) => l['msg'] === 'config loaded')).toMatchObject({ value: 'from-env-file' });
      } finally {
        envServer.kill('SIGKILL');
        await new Promise((resolve) => envServer.once('exit', resolve));
      }
    }, 30_000);
  });

  describe('https', () => {
    const hasOpenssl = !skip && spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;

    function tlsGet(url: string): Promise<RawResponse> {
      return new Promise((resolve, reject) => {
        const req = https.get(url, { rejectUnauthorized: false }, (res) => {
          const chunks: Buffer[] = [];

          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
          );
        });

        req.on('error', reject);
      });
    }

    test.skipIf(!hasOpenssl)(
      'serves TLS when SERVER_CERT_PATH and SERVER_KEY_PATH are set',
      async () => {
        const certDir = mkdtempSync(path.join(os.tmpdir(), 'astroscope-tls-'));
        const certPath = path.join(certDir, 'tls.crt');
        const keyPath = path.join(certDir, 'tls.key');

        const generated = spawnSync(
          'openssl',
          [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-keyout',
            keyPath,
            '-out',
            certPath,
            '-days',
            '2',
            '-nodes',
            '-subj',
            '/CN=localhost',
          ],
          { stdio: 'ignore' },
        );

        expect(generated.status).toBe(0);

        const tlsPort = port + 12;
        const tlsUrl = `https://127.0.0.1:${tlsPort}`;
        const tlsServer = spawn('node', ['dist/server/entry.mjs'], {
          cwd: fixtureRoot,
          env: {
            ...process.env,
            SERVER_CERT_PATH: certPath,
            SERVER_KEY_PATH: keyPath,
            HOST: '127.0.0.1',
            PORT: String(tlsPort),
            HEALTH_HOST: '127.0.0.1',
            HEALTH_PORT: String(port + 13),
            OTEL_EXPORTER_PROMETHEUS_HOST: '127.0.0.1',
            OTEL_EXPORTER_PROMETHEUS_PORT: String(port + 14),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';

        tlsServer.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()));
        tlsServer.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));

        try {
          const deadline = Date.now() + 15_000;
          let res: RawResponse | undefined;

          while (!res && Date.now() < deadline) {
            res = await tlsGet(`${tlsUrl}/`).catch(() => undefined);

            if (!res) await new Promise((resolve) => setTimeout(resolve, 100));
          }

          if (!res) throw new Error(`timed out waiting for the TLS server\n--- server output ---\n${output}`);

          expect(res.status).toBe(200);
          expect(res.body.toString()).toContain('<p id="state">initialized</p>');
          expect(logLines(output).find((l) => l['msg'] === 'server ready')).toMatchObject({ https: true });
        } finally {
          tlsServer.kill('SIGKILL');
          await new Promise((resolve) => tlsServer.once('exit', resolve));
          rmSync(certDir, { recursive: true, force: true });
        }
      },
      30_000,
    );

    test('fails startup when only one of the TLS env vars is set', async () => {
      const halfConfigured = spawn('node', ['dist/server/entry.mjs'], {
        cwd: fixtureRoot,
        env: {
          ...process.env,
          SERVER_CERT_PATH: '/nonexistent/tls.crt',
          HOST: '127.0.0.1',
          PORT: String(port + 15),
          HEALTH_HOST: '127.0.0.1',
          HEALTH_PORT: String(port + 16),
          OTEL_EXPORTER_PROMETHEUS_HOST: '127.0.0.1',
          OTEL_EXPORTER_PROMETHEUS_PORT: String(port + 17),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';

      halfConfigured.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()));
      halfConfigured.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));

      const code = await new Promise<number | null>((resolve) => halfConfigured.once('exit', resolve));

      expect(code).toBe(1);
      expect(output).toContain('SERVER_CERT_PATH and SERVER_KEY_PATH must both be set');
    }, 30_000);
  });

  describe('startup failure before logger construction', () => {
    test('dumps buffered logs and exits 1 when the config seam throws', async () => {
      const failing = spawn('node', ['dist/server/entry.mjs'], {
        cwd: fixtureRoot,
        env: {
          ...process.env,
          E2E_FAIL_CONFIG: '1',
          HOST: '127.0.0.1',
          PORT: String(port + 6),
          HEALTH_HOST: '127.0.0.1',
          HEALTH_PORT: String(port + 7),
          OTEL_EXPORTER_PROMETHEUS_HOST: '127.0.0.1',
          OTEL_EXPORTER_PROMETHEUS_PORT: String(port + 8),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';

      failing.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()));
      failing.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));

      const code = await new Promise<number | null>((resolve) => failing.once('exit', resolve));

      expect(code).toBe(1);
      expect(output).toContain('e2e config validation failed');
      // env loading is buffer-logged and dumped on failure — no silent phase
      expect(output).toContain('no env file loaded');
    }, 30_000);
  });

  test('no build-time injection into entry.mjs, no boot source path leak', () => {
    const entry = readFileSync(path.join(fixtureRoot, 'dist/server/entry.mjs'), 'utf8');

    expect(entry).not.toContain('__astroscope_bootSetup');
    expect(entry).not.toMatch(/"\/[^"]*\/src\/boot\.ts":/);
  });

  test('SIGTERM drains, runs onShutdown and exits 0', async () => {
    server!.kill('SIGTERM');

    await exited();

    expect(stdout).toContain('[e2e] shutdown');
    expect(exitCode).toBe(0);

    const shutdownIndex = stdout.indexOf('[e2e] shutdown');
    const startupIndex = stdout.indexOf('[e2e] startup');

    expect(shutdownIndex).toBeGreaterThan(startupIndex);

    const lines = logLines(stdout);
    const initiatedIndex = lines.findIndex((l) => l['msg'] === 'shutdown initiated');
    const completeIndex = lines.findIndex((l) => l['msg'] === 'shutdown complete');

    expect(initiatedIndex).toBeGreaterThanOrEqual(0);
    expect(completeIndex).toBeGreaterThan(initiatedIndex);
    expect(lines[completeIndex]!['drainMs']).toBeTypeOf('number');
  });
});
