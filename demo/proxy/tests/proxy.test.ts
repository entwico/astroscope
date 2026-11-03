import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startH2Upstream, startUpstream } from '../stub/upstream.mjs';

const DEV_PORT = 14_391;
const PROD_PORT = 14_392;
const UPSTREAM_PORT = 14_395;
const H2_UPSTREAM_PORT = 14_396;

type Echo = { method: string; url: string; httpVersion: string; headers: Record<string, string>; body: string };

let devServer: ChildProcess | null = null;
let prodServer: ChildProcess | null = null;
let upstream: ReturnType<typeof startUpstream> | null = null;
let h2Upstream: ReturnType<typeof startH2Upstream> | null = null;
let certDir: string | null = null;

// a throwaway certificate for the http/2 upstream; without openssl the h2 cases are skipped
function createCertificate(): { key: Buffer; cert: Buffer; certPath: string } | null {
  certDir = mkdtempSync(path.join(tmpdir(), 'proxy-e2e-'));

  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '2',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
  } catch {
    return null;
  }

  return { key: readFileSync(keyPath), cert: readFileSync(certPath), certPath };
}

const certificate = createCertificate();

// the child's output is drained from the start (an unread pipe stalls the child once it fills) and
// only surfaces when the server never comes up — a startup crash is invisible otherwise
async function waitForServer(server: ChildProcess, port: number, timeout = 30_000): Promise<void> {
  const output: string[] = [];

  const collect = (chunk: Buffer) => {
    output.push(chunk.toString());
  };

  server.stdout?.on('data', collect);
  server.stderr?.on('data', collect);

  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://localhost:${port}/`);

      if (res.ok) return;
    } catch {
      // server not ready yet
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  const exit = server.exitCode === null ? '' : ` (exited with code ${server.exitCode})`;

  throw new Error(`Server on port ${port} did not start within ${timeout}ms${exit}\n${output.join('')}`);
}

beforeAll(async () => {
  upstream = startUpstream({ port: UPSTREAM_PORT });

  await upstream.listening;

  if (certificate) {
    h2Upstream = startH2Upstream({ port: H2_UPSTREAM_PORT, key: certificate.key, cert: certificate.cert });

    await h2Upstream.listening;
  }

  // astro skips mounting its dev handlers when VITEST is set — the child must not inherit it
  const { VITEST: _vitest, ...env } = process.env;
  const proxyEnv = {
    PROXY_UPSTREAM: `http://localhost:${UPSTREAM_PORT}`,
    PROXY_H2_UPSTREAM: `https://localhost:${H2_UPSTREAM_PORT}`,
    // the upstream's self-signed certificate, trusted by node's tls alongside the system roots
    ...(certificate && { NODE_EXTRA_CA_CERTS: certificate.certPath }),
  };

  devServer = spawn('npx', ['astro', 'dev', '--port', String(DEV_PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
    env: { ...env, ...proxyEnv },
  });

  // prod server assumes the build already ran (turbo test depends on build);
  // health and metrics get their own ports so parallel demo suites don't collide
  prodServer = spawn('node', ['./dist/server/entry.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      ...proxyEnv,
      PORT: String(PROD_PORT),
      HEALTH_PORT: String(PROD_PORT + 1),
      OTEL_EXPORTER_PROMETHEUS_PORT: String(PROD_PORT + 2),
    },
    stdio: 'pipe',
  });

  await Promise.all([waitForServer(devServer, DEV_PORT), waitForServer(prodServer, PROD_PORT)]);
}, 60_000);

afterAll(async () => {
  // astro dev daemonizes under @astroscope/node — killing the wrapper is not enough
  spawn('npx', ['astro', 'dev', 'stop'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
  devServer?.kill();
  prodServer?.kill();
  await upstream?.close();
  await h2Upstream?.close();

  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

/** node's client sends headers as given, where fetch owns `connection` and the other hop-by-hop ones */
function rawRequest(
  port: number,
  requestPath: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: 'localhost', port, path: requestPath, method: 'GET', headers }, (res) => {
      let body = '';

      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });

    req.on('error', reject);
    req.end();
  });
}

describe.each([
  ['prod', PROD_PORT],
  ['dev', DEV_PORT],
])('%s', (_label, port) => {
  test('forwards the request under the upstream host with the forwarded headers set', async () => {
    const res = await fetch(`http://localhost:${port}/api/echo?x=1`, { headers: { 'x-custom': 'kept' } });
    const echo = (await res.json()) as Echo;

    expect(res.status).toBe(200);
    expect(echo.method).toBe('GET');
    expect(echo.url).toBe('/echo?x=1');
    expect(echo.headers['host']).toBe(`localhost:${UPSTREAM_PORT}`);
    expect(echo.headers['x-custom']).toBe('kept');
    expect(echo.headers['x-forwarded-for']).toBeTruthy();
    expect(echo.headers['x-forwarded-host']).toBe(`localhost:${port}`);
    expect(echo.headers['x-forwarded-proto']).toBe('http');
  });

  test('hop-by-hop headers of the client stay on the client connection, the ones it names too', async () => {
    const { status, body } = await rawRequest(port, '/api/echo', {
      connection: 'close, x-hop',
      'x-hop': 'per-connection',
      'keep-alive': 'timeout=5',
      'x-custom': 'kept',
    });
    const echo = JSON.parse(body) as Echo;

    expect(status).toBe(200);
    expect(echo.headers['x-hop']).toBeUndefined();
    expect(echo.headers['keep-alive']).toBeUndefined();
    expect(echo.headers['x-custom']).toBe('kept');
  });

  test('a body goes through astro to the upstream', async () => {
    const res = await fetch(`http://localhost:${port}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` },
      body: JSON.stringify({ hello: 'upstream' }),
    });
    const echo = (await res.json()) as Echo;

    expect(echo.method).toBe('POST');
    expect(JSON.parse(echo.body)).toEqual({ hello: 'upstream' });
  });

  test('an upstream redirect to itself is rewritten to the site', async () => {
    const res = await fetch(`http://localhost:${port}/api/redirect`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`http://localhost:${port}/echo`);
  });

  test('a cookie scoped to the upstream host loses its domain', async () => {
    const res = await fetch(`http://localhost:${port}/api/cookie`);
    const cookies = res.headers.getSetCookie();

    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toBe('session=1; Path=/; HttpOnly');
    expect(cookies[1]).toBe('theme=dark; Path=/');
  });

  test('an upstream status passes through', async () => {
    const res = await fetch(`http://localhost:${port}/api/status/418`);

    expect(res.status).toBe(418);
    expect(await res.text()).toBe('status 418');
  });

  test('an upstream that is down answers 502', async () => {
    const res = await fetch(`http://localhost:${port}/legacy/anything`);

    expect(res.status).toBe(502);
  });

  test.skipIf(!certificate)('an http/2-only upstream is spoken to over http/2', async () => {
    const res = await fetch(`http://localhost:${port}/h2/echo`);
    const echo = (await res.json()) as Echo;

    expect(res.status).toBe(200);
    expect(echo.httpVersion).toBe('2.0');
    expect(echo.url).toBe('/echo');
  });
});
