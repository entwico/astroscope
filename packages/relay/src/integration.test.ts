import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { RELAY_QUEUE_SCRIPT } from './inline.js';
import relayIntegration from './integration.js';

const roots: string[] = [];

/** a site root with the given files, as astro passes it: a directory url */
function createSite(files: string[]): URL {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-integration-'));

  roots.push(root);

  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'export default {};');
  }

  return pathToFileURL(`${root}/`);
}

function setup(root: URL, srcDir: URL = new URL('src/', root)) {
  const injectScript = vi.fn();
  const addMiddleware = vi.fn();
  const hook = relayIntegration().hooks['astro:config:setup'] as (params: unknown) => void;

  hook({ addMiddleware, config: { root, srcDir }, injectScript, logger: { info: vi.fn() }, updateConfig: vi.fn() });

  return { injectScript, addMiddleware };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('relay integration', () => {
  test('loads the client module on every page when the file exists', () => {
    const { injectScript } = setup(createSite(['src/relay/client.ts']));

    expect(injectScript).toHaveBeenCalledWith('head-inline', RELAY_QUEUE_SCRIPT);
    expect(injectScript).toHaveBeenCalledWith('page', 'import "virtual:@astroscope/relay/client";');
  });

  test('ships no script without the client module, the middleware regardless', () => {
    const { injectScript, addMiddleware } = setup(createSite([]));

    expect(injectScript).not.toHaveBeenCalled();
    expect(addMiddleware).toHaveBeenCalledWith({ order: 'pre', entrypoint: '@astroscope/relay/middleware' });
  });

  test('the client build refuses the server registry under any query suffix', async () => {
    const updateConfig = vi.fn();
    const hook = relayIntegration().hooks['astro:config:setup'] as (params: unknown) => void;
    const root = createSite([]);

    hook({
      addMiddleware: vi.fn(),
      config: { root, srcDir: new URL('src/', root) },
      injectScript: vi.fn(),
      logger: { info: vi.fn() },
      updateConfig,
    });

    const [plugin] = updateConfig.mock.calls[0]?.[0].vite.plugins as { load: (id: string) => Promise<unknown> }[];
    const client = { environment: { name: 'client' }, resolve: () => Promise.resolve(null) };
    const load = (id: string) => plugin!.load.call(client, id);

    await expect(load('/site/src/relay/server.ts')).rejects.toThrow('server-only');
    await expect(load('/site/src/relay/server.ts?raw')).rejects.toThrow('server-only');
    await expect(load('/site/src/relay/server.ts?url')).rejects.toThrow('server-only');
  });

  test('finds the client module under a custom srcDir', () => {
    const root = createSite(['app/relay/client.ts']);
    const { injectScript } = setup(root, new URL('app/', root));

    expect(injectScript).toHaveBeenCalledWith('page', 'import "virtual:@astroscope/relay/client";');
  });

  test('resolves the halves under the srcDir in the vite plugin', async () => {
    const updateConfig = vi.fn();
    const hook = relayIntegration().hooks['astro:config:setup'] as (params: unknown) => void;
    const root = createSite(['app/relay/client.ts', 'app/relay/server.ts']);

    hook({
      addMiddleware: vi.fn(),
      config: { root, srcDir: new URL('app/', root) },
      injectScript: vi.fn(),
      logger: { info: vi.fn() },
      updateConfig,
    });

    const [plugin] = updateConfig.mock.calls[0]?.[0].vite.plugins as {
      resolveId: (id: string) => Promise<unknown>;
      load: (id: string) => Promise<unknown>;
    }[];
    const resolved: string[] = [];
    const context = {
      environment: { name: 'client' },
      resolve: (id: string) => {
        resolved.push(id);

        return Promise.resolve({ id });
      },
    };

    expect(await plugin!.resolveId.call(context, '@astroscope/relay/registry')).toBe('/app/relay/server.ts');
    expect(await plugin!.load.call(context, '\0virtual:@astroscope/relay/client')).toContain('import config from "/app/relay/client.ts";');
    await expect(plugin!.load.call(context, '/site/app/relay/server.ts?raw')).rejects.toThrow('server-only');
    expect(resolved).toEqual(['/app/relay/server.ts', '/app/relay/client.ts']);
  });
});
