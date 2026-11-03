import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type * as islands from '@astroscope/node/islands';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WormholeManifest } from './types';
import { wormholeVitePlugin } from './vite-plugin';

const mocks = vi.hoisted(() => ({
  patternsByModule: new Map<string, string[]>(),
}));

vi.mock('@astroscope/node/islands', async (importOriginal) => ({
  ...(await importOriginal<typeof islands>()),
  collectRouteIslands: () => {
    const routes = new Map<string, unknown>();

    for (const patterns of mocks.patternsByModule.values()) {
      patterns.forEach((pattern) => routes.set(pattern, []));
    }

    return Promise.resolve({ routes, patternsByModule: mocks.patternsByModule });
  },
}));

const READER = `
  import { wormholes } from '@astroscope/wormhole';

  export const read = () => wormholes.cart.get();
`;

type Hook = (this: unknown, ...args: unknown[]) => unknown;

let dist = '';

/** runs a build: server transforms and bundle, then client transforms and bundle; returns the written manifest */
async function build(options: {
  server?: Record<string, string>;
  client?: Record<string, string>;
  chunks?: { fileName: string; moduleIds: string[] }[];
}): Promise<WormholeManifest> {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'wormhole-plugin-'));
  fs.mkdirSync(path.join(dist, 'server', 'chunks'), { recursive: true });

  const plugin = wormholeVitePlugin({ registryPath: null, exclude: null, pages: () => new Map() });
  const hook = (name: string) => plugin[name as keyof typeof plugin] as unknown as Hook;
  const server = { environment: { name: 'ssr' } };
  const client = { environment: { name: 'client' } };

  hook('configResolved')({ command: 'build' });

  const serverModules = Object.entries(options.server ?? {});
  const clientModules = Object.entries(options.client ?? {});

  for (const [id, code] of serverModules) {
    await hook('transform').call(server, code, id);
  }

  await hook('generateBundle').call(server);

  for (const [id, code] of clientModules) {
    await hook('transform').call(client, code, id);
  }

  const bundle = Object.fromEntries(
    (options.chunks ?? []).map((chunk) => [
      chunk.fileName,
      { type: 'chunk', imports: [], dynamicImports: [], isEntry: false, facadeModuleId: null, ...chunk },
    ]),
  );

  hook('writeBundle').call(client, { dir: path.join(dist, 'client') }, bundle);

  return JSON.parse(fs.readFileSync(path.join(dist, 'server', 'chunks', 'wormhole-manifest.json'), 'utf8'));
}

afterEach(() => {
  mocks.patternsByModule = new Map();
  fs.rmSync(dist, { recursive: true, force: true });
});

describe('wormholeVitePlugin', () => {
  test('attributes client reads to the chunk containing the module', async () => {
    const manifest = await build({
      client: { '/src/lib/read.ts': READER },
      chunks: [{ fileName: '_astro/Island.abc.js', moduleIds: ['/src/lib/read.ts'] }],
    });

    expect(manifest.chunks).toEqual({ 'Island.abc': ['cart'] });
  });

  test('attributes client reads of .mts and .mjs modules', async () => {
    const manifest = await build({
      client: { '/src/lib/read.mts': READER, '/src/lib/other.mjs': READER.replace('cart', 'session') },
      chunks: [{ fileName: '_astro/Island.abc.js', moduleIds: ['/src/lib/read.mts', '/src/lib/other.mjs'] }],
    });

    expect(manifest.chunks['Island.abc']).toEqual(expect.arrayContaining(['cart', 'session']));
  });

  test('attributes server reads to the routes reaching the module', async () => {
    mocks.patternsByModule = new Map([['/src/pages/post.astro', ['/post']]]);

    const manifest = await build({ server: { '/src/pages/post.astro': READER } });

    expect(manifest.routes['/post']).toEqual(['cart']);
  });

  test('attributes server reads of .mdx pages and .mts modules to their routes', async () => {
    mocks.patternsByModule = new Map([
      ['/src/pages/post.mdx', ['/post']],
      ['/src/lib/read.mts', ['/post']],
    ]);

    const manifest = await build({
      server: { '/src/pages/post.mdx': READER, '/src/lib/read.mts': READER.replace('cart', 'session') },
    });

    expect(manifest.routes['/post']).toEqual(expect.arrayContaining(['cart', 'session']));
  });
});
