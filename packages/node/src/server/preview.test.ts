import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import createPreviewServer from './preview';

interface EntryState {
  overrides: unknown;
  autostart: string | undefined;
  stopCalls: number;
  closedCalls: number;
}

const STATE_KEY = '__astroscope_preview_test_state';

const ENTRY_SOURCE = `export async function startServer(overrides) {
  const state = {
    overrides,
    autostart: process.env.ASTROSCOPE_NODE_AUTOSTART,
    stopCalls: 0,
    closedCalls: 0,
  };

  globalThis['${STATE_KEY}'] = state;

  return {
    host: overrides.host,
    port: overrides.port,
    stop: async () => { state.stopCalls += 1; },
    closed: async () => { state.closedCalls += 1; },
  };
}
`;

let entryDir: string | undefined;
let entryUrl: URL | undefined;

async function getEntryUrl(): Promise<URL> {
  if (!entryUrl) {
    entryDir = await mkdtemp(path.join(os.tmpdir(), 'astroscope-preview-'));

    const entryPath = path.join(entryDir, 'entry.mjs');

    await writeFile(entryPath, ENTRY_SOURCE);

    entryUrl = pathToFileURL(entryPath);
  }

  return entryUrl;
}

function getState(): EntryState {
  return (globalThis as Record<string, unknown>)[STATE_KEY] as EntryState;
}

const originalAutostart = process.env['ASTROSCOPE_NODE_AUTOSTART'];

afterEach(() => {
  if (originalAutostart === undefined) {
    delete process.env['ASTROSCOPE_NODE_AUTOSTART'];
  } else {
    process.env['ASTROSCOPE_NODE_AUTOSTART'] = originalAutostart;
  }

  delete (globalThis as Record<string, unknown>)[STATE_KEY];
});

afterAll(async () => {
  if (entryDir) {
    await rm(entryDir, { recursive: true, force: true });
  }
});

describe('createPreviewServer', () => {
  test('disables autostart, starts the entry with the preview host/port and exposes the handle address', async () => {
    const params = {
      serverEntrypoint: await getEntryUrl(),
      host: '127.0.0.1',
      port: 4321,
    } as Parameters<typeof createPreviewServer>[0];

    const preview = await createPreviewServer(params);
    const state = getState();

    expect(state.autostart).toBe('disabled');
    expect(state.overrides).toEqual({ host: '127.0.0.1', port: 4321 });
    expect(preview.host).toBe('127.0.0.1');
    expect(preview.port).toBe(4321);
  });

  test('stop and closed delegate to the server handle', async () => {
    const params = {
      serverEntrypoint: await getEntryUrl(),
      host: 'localhost',
      port: 8080,
    } as Parameters<typeof createPreviewServer>[0];

    const preview = await createPreviewServer(params);

    await preview.stop();
    await preview.closed();

    const state = getState();

    expect(state.stopCalls).toBe(1);
    expect(state.closedCalls).toBe(1);
  });
});
