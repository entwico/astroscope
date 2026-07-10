import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { devFixtureRoot, devSkip } from './fixture';

const bootFile = path.join(devFixtureRoot, 'src/boot.ts');

type DevServer = {
  address: { address: string; port: number };
  stop: () => Promise<void>;
};

describe.skipIf(devSkip)('dev-mode restart with in-flight requests', () => {
  let server: DevServer;
  let stderrBuf: string;
  let stdoutBuf: string;
  let restoreStderr: () => void;
  let restoreStdout: () => void;

  beforeAll(async () => {
    stderrBuf = '';
    stdoutBuf = '';

    const origStderr = process.stderr.write.bind(process.stderr);
    const origStdout = process.stdout.write.bind(process.stdout);

    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

      return true;
    }) as never;

    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

      return true;
    }) as never;

    // vitest's console.log wrapper bypasses process.stdout.write — capture both
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      stdoutBuf += `${args.join(' ')}\n`;
    });

    restoreStderr = () => {
      process.stderr.write = origStderr as never;
    };
    restoreStdout = () => {
      process.stdout.write = origStdout as never;
    };

    const { dev } = await import('astro');

    server = (await dev({
      root: devFixtureRoot,
      logLevel: 'info',
      server: { port: 0, host: 'localhost' },
    })) as unknown as DevServer;
  }, 60_000);

  afterAll(async () => {
    await server?.stop().catch(() => {});
    restoreStderr?.();
    restoreStdout?.();
    vi.restoreAllMocks();
  });

  // linux resolves "localhost" to ::1 — bracket ipv6 hosts to keep the url parseable
  const getBaseUrl = () => {
    const host = server.address.address.includes(':') ? `[${server.address.address}]` : server.address.address;

    return `http://${host}:${server.address.port}`;
  };

  test('native mounts dispatch in dev with the real connect req/res', async () => {
    const res = await fetch(`${getBaseUrl()}/native/echo`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ native: true, url: '/native/echo' });
  });

  test('getBootContext() is stamped before onStartup across the vite-runner boundary', () => {
    expect(stripAnsi(stdoutBuf)).toContain('[dev-e2e] startup ctx=ok');
  });

  test('a stale request whose singleton was disposed mid-render is silenced', async () => {
    const baseUrl = getBaseUrl();

    // warm up so first-compile cost isn't in the restart-window timing
    await fetch(`${baseUrl}/slow?delay=0`)
      .then((r) => r.text())
      .catch(() => {});

    stderrBuf = '';
    stdoutBuf = '';

    // must outlast the restart pipeline so disposeSingleton fires before readSingleton
    const slowDelayMs = 8000;

    void fetch(`${baseUrl}/slow?delay=${slowDelayMs}`).catch(() => undefined);

    const requestStart = Date.now();

    await new Promise((resolve) => setTimeout(resolve, 300));

    const bootSource = readFileSync(bootFile, 'utf8');

    // try/finally — a failing assertion would otherwise leave "// touched at <ts>" in the fixture
    try {
      writeFileSync(bootFile, `${bootSource}\n// touched at ${Date.now()}\n`);

      // "server restarted" is logged after priorShutdown awaits, so disposeSingleton has fired
      await waitFor(() => /\[vite\] server restarted\./.test(stripAnsi(stdoutBuf)), 25_000);

      const remaining = slowDelayMs - (Date.now() - requestStart);

      // +500ms for recordStaleError's 50ms flush buffer + propagation
      await new Promise((resolve) => setTimeout(resolve, Math.max(remaining, 0) + 500));

      expect(stripAnsi(stderrBuf)).not.toContain('singleton used before init or after dispose');
      expect(stripAnsi(stdoutBuf)).toMatch(/\[@astroscope\/node\] suppressed \d+ stale request error/);
    } finally {
      writeFileSync(bootFile, bootSource);
    }
  }, 60_000);

  test('native mounts are re-registered by the next generation after a restart', async () => {
    // the fixture restore above triggers one more restart — poll through the gate
    const deadline = Date.now() + 25_000;
    let body: unknown;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${getBaseUrl()}/native/echo`);

        if (res.status === 200) {
          body = await res.json();
          break;
        }
      } catch {
        // server mid-restart — keep polling
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(body).toEqual({ native: true, url: '/native/echo' });
  }, 30_000);
});

// vite wraps [vite] / [@astroscope/node] prefixes in ANSI codes — strip for literal regexes
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();

  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
