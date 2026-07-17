import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { fixtureRoot, skip } from './fixture';

const metadataFile = path.join(fixtureRoot, 'node_modules/.vite/deps/_metadata.json');
const lateComponentFile = path.join(fixtureRoot, 'src/components/LateIsland.tsx');
const latePageFile = path.join(fixtureRoot, 'src/pages/late-island.astro');

type DevServer = {
  address: { address: string; port: number };
  stop: () => Promise<void>;
};

interface DepMetadata {
  browserHash: string;
  optimized: Record<string, unknown>;
  discovered?: Record<string, unknown>;
}

function readMetadata(): DepMetadata | undefined {
  if (!existsSync(metadataFile)) return undefined;

  try {
    return JSON.parse(readFileSync(metadataFile, 'utf8')) as DepMetadata;
  } catch {
    // mid-write — the poller retries
    return undefined;
  }
}

function optimizedDeps(): string[] {
  const metadata = readMetadata();

  if (!metadata) return [];

  return [...Object.keys(metadata.optimized ?? {}), ...Object.keys(metadata.discovered ?? {})];
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();

  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(skip)('dev island warmup', () => {
  let server: DevServer;
  let stdoutBuf: string;
  let restoreStdout: () => void;
  let vitestEnv: string | undefined;

  beforeAll(async () => {
    // astro skips mounting its dev handlers when VITEST is set; the guard is
    // re-checked on every restart, so it stays unset for the whole suite
    vitestEnv = process.env['VITEST'];
    delete process.env['VITEST'];

    // cold optimizer cache — the point of the suite is startup discovery
    rmSync(path.join(fixtureRoot, 'node_modules/.vite'), { recursive: true, force: true });

    stdoutBuf = '';

    const origStdout = process.stdout.write.bind(process.stdout);

    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

      return true;
    }) as never;

    vi.spyOn(console, 'log').mockImplementation((...args) => {
      stdoutBuf += `${args.join(' ')}\n`;
    });

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

    if (vitestEnv !== undefined) process.env['VITEST'] = vitestEnv;

    restoreStdout?.();
    vi.restoreAllMocks();
    rmSync(lateComponentFile, { force: true });
    rmSync(latePageFile, { force: true });
  });

  const getBaseUrl = () => {
    const host = server.address.address.includes(':') ? `[${server.address.address}]` : server.address.address;

    return `http://${host}:${server.address.port}`;
  };

  test('scans the fixture and reports hydrated islands', () => {
    expect(stripAnsi(stdoutBuf)).toMatch(/warming \d+ island\(s\), pre-optimizing \d+ dependenc/);
  });

  test('island-only deps are optimized before any page is requested', async () => {
    await waitFor(() => optimizedDeps().includes('clsx'), 20_000);

    expect(optimizedDeps()).toContain('clsx');
  }, 25_000);

  test('loading the page causes no re-optimization', async () => {
    await waitFor(() => readMetadata() !== undefined, 20_000);

    const hashBefore = readMetadata()!.browserHash;
    const res = await fetch(`${getBaseUrl()}/`);

    expect(res.status).toBe(200);

    // give a would-be re-optimization time to run and commit
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(readMetadata()!.browserHash).toBe(hashBefore);
    expect(stripAnsi(stdoutBuf)).not.toContain('new dependencies optimized');
  }, 30_000);

  test('islands added mid-session are discovered at save time, without a page load', async () => {
    writeFileSync(
      lateComponentFile,
      `import { parse } from 'cookie';

export function LateIsland() {
  return <span>{Object.keys(parse('a=1')).length}</span>;
}
`,
    );

    mkdirSync(path.dirname(latePageFile), { recursive: true });
    writeFileSync(
      latePageFile,
      `---
import { LateIsland } from '../components/LateIsland';
---
<LateIsland client:load />
`,
    );

    await waitFor(() => optimizedDeps().includes('cookie'), 20_000);

    expect(optimizedDeps()).toContain('cookie');
  }, 25_000);
});

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
