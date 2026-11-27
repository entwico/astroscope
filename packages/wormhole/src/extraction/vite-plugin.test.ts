import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as islands from '@astroscope/node/islands';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WormholeManifest } from './types';
import { type WormholeVitePluginOptions, wormholeVitePlugin } from './vite-plugin';

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

const DYNAMIC_READER = `
  import { wormholes } from '@astroscope/wormhole';

  export const read = (name) => wormholes[name].get();
`;

const SCRIPT_QUERY = '?astro&type=script&index=0&lang.ts';

type Hook = (this: unknown, ...args: unknown[]) => unknown;

type Chunk = {
  fileName: string;
  moduleIds: string[];
  imports?: string[] | undefined;
  dynamicImports?: string[] | undefined;
  isEntry?: boolean | undefined;
  isDynamicEntry?: boolean | undefined;
  facadeModuleId?: string | undefined;
};

const serverContext = { environment: { name: 'ssr' } };
const clientContext = { environment: { name: 'client' } };

function createPlugin(options: Partial<WormholeVitePluginOptions> = {}, command: 'build' | 'serve' = 'build') {
  const plugin = wormholeVitePlugin({ registryPath: null, exclude: null, pages: () => new Map(), ...options });
  const hook = (name: string) => plugin[name as keyof typeof plugin] as unknown as Hook;

  hook('configResolved')({ command });

  return hook;
}

let dist = '';

/** runs a build: server transforms and bundle, then client transforms and bundle; returns the written manifest */
async function build(options: {
  server?: Record<string, string>;
  client?: Record<string, string>;
  chunks?: Chunk[];
}): Promise<WormholeManifest> {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'wormhole-plugin-'));
  fs.mkdirSync(path.join(dist, 'server', 'chunks'), { recursive: true });

  const hook = createPlugin();
  const server = serverContext;
  const client = clientContext;

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

  test('a dynamic server read opens every wormhole for the routes reaching it', async () => {
    mocks.patternsByModule = new Map([
      ['/src/pages/post.astro', ['/post']],
      ['/src/pages/index.astro', ['/']],
    ]);

    const manifest = await build({
      server: { '/src/pages/post.astro': DYNAMIC_READER, '/src/pages/index.astro': READER },
    });

    expect(manifest.routes).toEqual({ '/post': ['*'], '/': ['cart'] });
  });

  test('a route whose modules read nothing is known and loads nothing', async () => {
    mocks.patternsByModule = new Map([['/src/pages/about.astro', ['/about']]]);

    const manifest = await build({ server: { '/src/pages/about.astro': 'export const a = 1;' } });

    expect(manifest.routes).toEqual({ '/about': [] });
    expect(manifest.scriptsByRoute).toEqual({ '/about': [] });
  });

  test('ignores modules from node_modules', async () => {
    const manifest = await build({
      client: { '/node_modules/pkg/read.js': READER },
      chunks: [{ fileName: '_astro/Island.abc.js', moduleIds: ['/node_modules/pkg/read.js'] }],
    });

    expect(manifest.chunks).toEqual({});
  });
});

describe('script entries', () => {
  const widgetScript = `/src/components/Widget.astro${SCRIPT_QUERY}`;

  test('collects the names a script reaches through its chunk imports', async () => {
    const manifest = await build({
      client: {
        [widgetScript]: READER,
        '/src/lib/session.ts': READER.replace('cart', 'session'),
        '/src/lib/lazy.ts': READER.replace('cart', 'user'),
        '/src/islands/Island.tsx': READER.replace('cart', 'island'),
      },
      chunks: [
        {
          fileName: '_astro/Widget.astro_astro_type_script.aaa.js',
          moduleIds: [widgetScript],
          isEntry: true,
          facadeModuleId: widgetScript,
          imports: ['_astro/shared.bbb.js'],
        },
        {
          fileName: '_astro/shared.bbb.js',
          moduleIds: ['/src/lib/session.ts'],
          imports: ['_astro/Widget.astro_astro_type_script.aaa.js'],
          dynamicImports: ['_astro/lazy.ccc.js'],
        },
        { fileName: '_astro/lazy.ccc.js', moduleIds: ['/src/lib/lazy.ts'] },
        { fileName: '_astro/Island.ddd.js', moduleIds: ['/src/islands/Island.tsx'], isEntry: true },
      ],
    });

    expect(manifest.scripts.toSorted((a, b) => a.localeCompare(b))).toEqual(['cart', 'session', 'user']);
  });

  test('attributes a script to the routes reaching the component owning it', async () => {
    mocks.patternsByModule = new Map([
      ['/src/pages/index.astro', ['/']],
      ['/src/pages/post.astro', ['/post']],
      ['/src/components/Widget.astro', ['/post']],
    ]);

    const manifest = await build({
      server: { '/src/pages/index.astro': READER.replace('cart', 'session') },
      client: { [widgetScript]: READER },
      chunks: [{ fileName: '_astro/script.aaa.js', moduleIds: [widgetScript], isEntry: true, facadeModuleId: widgetScript }],
    });

    expect(manifest.scriptsByRoute).toEqual({ '/': [], '/post': ['cart'] });
    expect(manifest.routes).toEqual({ '/': ['session'], '/post': ['cart'] });
  });

  test('a script whose component the server build never saw goes to every route', async () => {
    mocks.patternsByModule = new Map([
      ['/src/pages/index.astro', ['/']],
      ['/src/pages/post.astro', ['/post']],
    ]);

    const manifest = await build({
      client: { '/src/lib/read.ts': READER },
      chunks: [
        {
          fileName: '_astro/page.aaa.js',
          moduleIds: ['/src/lib/read.ts'],
          isDynamicEntry: true,
          facadeModuleId: 'astro:scripts/page.js',
        },
      ],
    });

    expect(manifest.scriptsByRoute).toEqual({ '/': ['cart'], '/post': ['cart'] });
    expect(manifest.routes).toEqual({ '/': ['cart'], '/post': ['cart'] });
  });

  test('a dynamic read in a script delivers every open wormhole to its routes', async () => {
    mocks.patternsByModule = new Map([['/src/components/Widget.astro', ['/post']]]);

    const manifest = await build({
      client: { [widgetScript]: DYNAMIC_READER },
      chunks: [{ fileName: '_astro/script.aaa.js', moduleIds: [widgetScript], isEntry: true, facadeModuleId: widgetScript }],
    });

    expect(manifest.scripts).toEqual(['*']);
    expect(manifest.scriptsByRoute).toEqual({ '/post': ['*'] });
  });

  test('island entries are not script consumers', async () => {
    mocks.patternsByModule = new Map([['/src/pages/index.astro', ['/']]]);

    const manifest = await build({
      client: { '/src/islands/Island.tsx': READER },
      chunks: [
        {
          fileName: '_astro/Island.ddd.js',
          moduleIds: ['/src/islands/Island.tsx'],
          isEntry: true,
          facadeModuleId: '/src/islands/Island.tsx',
        },
      ],
    });

    expect(manifest.scripts).toEqual([]);
    expect(manifest.scriptsByRoute).toEqual({ '/': [] });
    expect(manifest.chunks).toEqual({ 'Island.ddd': ['cart'] });
  });
});

describe('manifest output', () => {
  test('the server build writes no manifest', () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'wormhole-plugin-'));
    fs.mkdirSync(path.join(dist, 'server', 'chunks'), { recursive: true });

    createPlugin()('writeBundle').call(serverContext, { dir: path.join(dist, 'server') }, {});
    createPlugin()('writeBundle').call(clientContext, {}, {});

    expect(fs.readdirSync(path.join(dist, 'server', 'chunks'))).toEqual([]);
  });

  test('reports a missing server chunks directory instead of creating it', () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'wormhole-plugin-'));

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      createPlugin()('writeBundle').call(clientContext, { dir: path.join(dist, 'client') }, {});

      expect(error).toHaveBeenCalledExactlyOnceWith(
        `[@astroscope/wormhole] server chunks directory not found, cannot write manifest to ${path.join(dist, 'server', 'chunks')}`,
      );
      expect(fs.existsSync(path.join(dist, 'server'))).toBe(false);
    } finally {
      error.mockRestore();
    }
  });
});

describe('virtual modules', () => {
  const MANIFEST_ID = 'virtual:@astroscope/wormhole/manifest';
  const REGISTRY_ID = 'virtual:@astroscope/wormhole/registry';
  const CONFIG_ID = 'virtual:@astroscope/wormhole/config';

  async function evaluate(code: string): Promise<Record<string, unknown>> {
    return (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as Record<string, unknown>;
  }

  test('the registry resolves straight to the project file', () => {
    const hook = createPlugin({ registryPath: '/project/src/wormholes.ts' });

    expect(hook('resolveId').call({}, REGISTRY_ID)).toBe('/project/src/wormholes.ts');
  });

  test('without a registry file the registry is an empty stub', async () => {
    const hook = createPlugin();
    const id = hook('resolveId').call({}, REGISTRY_ID) as string;

    expect(await evaluate(hook('load').call(serverContext, id) as string)).toMatchObject({ wormholes: {} });
  });

  test('leaves foreign ids to other resolvers and loaders', () => {
    const hook = createPlugin({ registryPath: '/project/src/wormholes.ts' });

    expect(hook('resolveId').call({}, 'virtual:@astroscope/wormhole/other')).toBeUndefined();
    expect(hook('load').call(serverContext, '/project/src/pages/index.astro')).toBeUndefined();
  });

  test('the registry file loads on the server and throws in the client environment', () => {
    const hook = createPlugin({ registryPath: '/project/src/wormholes.ts' });

    expect(hook('load').call(serverContext, '/project/src/wormholes.ts')).toBeUndefined();
    expect(hook('load').call({}, '/project/src/wormholes.ts')).toBeUndefined();
    expect(() => hook('load').call(clientContext, '/project/src/wormholes.ts')).toThrow(
      /wormholes\.ts is server-only — client code reads wormholes through the `wormholes` proxy/,
    );
  });

  test('the config module carries regexp exclude patterns as code', async () => {
    const hook = createPlugin({ exclude: [{ pattern: /^\/api\// }, { exact: '/health' }] });
    const id = hook('resolveId').call({}, CONFIG_ID) as string;

    expect(await evaluate(hook('load').call(serverContext, id) as string)).toMatchObject({
      exclude: [{ pattern: /^\/api\// }, { exact: '/health' }],
    });
  });

  test('the config module exports a null exclude for the default', async () => {
    const hook = createPlugin();
    const id = hook('resolveId').call({}, CONFIG_ID) as string;

    expect(await evaluate(hook('load').call(serverContext, id) as string)).toMatchObject({ exclude: null });
  });

  test('dev has no manifest', async () => {
    const hook = createPlugin({}, 'serve');
    const id = hook('resolveId').call({}, MANIFEST_ID) as string;

    expect(await evaluate(hook('load').call(serverContext, id) as string)).toMatchObject({ manifest: null });
  });

  describe('built manifest module', () => {
    const manifest = { chunks: {}, scripts: [], scriptsByRoute: {}, routes: { '/': ['cart'] } };

    /** writes the module where astro would bundle it and the manifest where the client build drops it */
    async function loadBuilt(modulePath: string, manifestPath: string | null) {
      dist = fs.mkdtempSync(path.join(os.tmpdir(), 'wormhole-plugin-'));

      const hook = createPlugin();
      const id = hook('resolveId').call({}, MANIFEST_ID) as string;
      const file = path.join(dist, modulePath);

      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, hook('load').call(serverContext, id) as string);

      if (manifestPath) {
        fs.mkdirSync(path.dirname(path.join(dist, manifestPath)), { recursive: true });
        fs.writeFileSync(path.join(dist, manifestPath), JSON.stringify(manifest));
      }

      return (await import(pathToFileURL(file).href)) as { manifest: unknown };
    }

    test.each([
      { name: 'next to a chunk', module: 'server/chunks/wormhole.mjs' },
      { name: 'from the server root', module: 'server/middleware.mjs' },
      { name: 'from a sibling directory of chunks', module: 'server/pages/index.mjs' },
    ])('reads the manifest $name', async ({ module }) => {
      const built = await loadBuilt(module, 'server/chunks/wormhole-manifest.json');

      expect(built.manifest).toEqual(manifest);
    });

    test('is null when the build wrote no manifest', async () => {
      const built = await loadBuilt('server/chunks/wormhole.mjs', null);

      expect(built.manifest).toBeNull();
    });
  });
});
