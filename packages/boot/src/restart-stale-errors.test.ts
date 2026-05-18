import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const fixtureRoot = path.resolve(fileURLToPath(import.meta.url), '../../../../demo/boot-restart');
const bootFile = path.join(fixtureRoot, 'src/boot.ts');

type DevServer = {
  address: { address: string; port: number };
  stop: () => Promise<void>;
};

const skip = !existsSync(path.join(fixtureRoot, 'node_modules'));

describe.skipIf(skip)('dev-mode restart with in-flight requests', () => {
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

    // vitest replaces console.log with its own wrapper that bypasses
    // process.stdout.write, so we have to capture both.
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
      root: fixtureRoot,
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

  test('a stale request whose singleton was disposed mid-render is silenced', async () => {
    const baseUrl = `http://${server.address.address}:${server.address.port}`;

    // warm up: hit the page once with a tiny delay so the route is compiled
    // (the restart-window race below shouldn't include the first-compile cost)
    await fetch(`${baseUrl}/slow?delay=0`)
      .then((r) => r.text())
      .catch(() => {});

    // clear the captured buffers so assertions only see the restart-window output
    stderrBuf = '';
    stdoutBuf = '';

    const slowDelayMs = 2500;

    // start a slow request that will still be `await new Promise(setTimeout(...))`
    // when the restart fires below. swallow socket teardown — the server-side
    // render still throws and gets logged regardless of whether the client socket
    // survives the restart.
    void fetch(`${baseUrl}/slow?delay=${slowDelayMs}`).catch(() => undefined);

    const requestStart = Date.now();

    // give the request time to enter its delay before we trigger a restart
    await new Promise((resolve) => setTimeout(resolve, 400));

    // write the boot file to itself to force a watcher event
    const bootSource = readFileSync(bootFile, 'utf8');

    writeFileSync(bootFile, `${bootSource}\n// touched at ${Date.now()}\n`);

    // wait until the slow render's setTimeout has resolved server-side, then
    // a bit more for astro's error pipeline to flush the log to stderr.
    const remaining = slowDelayMs - (Date.now() - requestStart);

    await new Promise((resolve) => setTimeout(resolve, remaining + 2000));

    // restore the file so the working tree stays clean
    writeFileSync(bootFile, bootSource);

    // the runtime middleware catches the stale-request error so the multi-line
    // stack trace never reaches the logger.
    expect(stderrBuf).not.toContain('singleton used before init or after dispose');

    // instead, a single concise line summarises what was suppressed.
    expect(stdoutBuf).toMatch(/\[@astroscope\/boot\] suppressed \d+ stale request error/);
  }, 30_000);
});
