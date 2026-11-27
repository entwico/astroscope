import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Rolldown } from 'vite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ISLANDS_VIRTUAL_MODULE_ID, createIslandsManifestPlugin } from './manifest-plugin';
import type { IslandsManifest } from './types';

type Hook = (this: unknown, ...args: unknown[]) => unknown;

type Chunk = {
  fileName: string;
  imports?: string[];
  dynamicImports?: string[];
  isEntry?: boolean;
  facadeModuleId?: string | null;
};

type VirtualModule = { manifest: IslandsManifest | null; preload: boolean };

const RUNTIME_FILE = 'islands-runtime.iife.js';

let dist = '';
let runtimeSource = '';

const logger = { warn: vi.fn() };

function createPlugin(options: { preload?: boolean; pages?: Map<string, string[]> } = {}) {
  const plugin = createIslandsManifestPlugin({
    logger,
    preload: options.preload ?? true,
    pages: () => options.pages ?? new Map(),
  });

  return (name: string) => plugin[name as keyof typeof plugin] as unknown as Hook;
}

/** the server build's plugin context: the module graph the route attribution walks */
function serverContext(modules: Record<string, { imports?: string[]; hydrated?: string[] }>) {
  return {
    environment: { name: 'ssr' },
    getModuleIds: () => Object.keys(modules)[Symbol.iterator](),
    getModuleInfo: (id: string) => {
      const module = modules[id];

      if (!module) return null;

      return {
        id,
        importedIds: module.imports ?? [],
        dynamicallyImportedIds: [],
        meta: {
          astro: {
            hydratedComponents: (module.hydrated ?? []).map((resolvedPath) => ({
              exportName: 'default',
              specifier: resolvedPath,
              resolvedPath,
            })),
          },
        },
      } as unknown as Rolldown.ModuleInfo;
    },
    resolve: () => Promise.resolve(null),
  };
}

const client = { environment: { name: 'client' } };

function toBundle(chunks: Chunk[], assets: string[] = []): Record<string, unknown> {
  return Object.fromEntries([
    ...chunks.map((chunk) => [
      chunk.fileName,
      { type: 'chunk', imports: [], dynamicImports: [], isEntry: false, facadeModuleId: null, ...chunk },
    ]),
    ...assets.map((fileName) => [fileName, { type: 'asset', fileName }]),
  ]);
}

function readManifest(): IslandsManifest {
  return JSON.parse(fs.readFileSync(path.join(dist, 'server', 'chunks', 'islands-manifest.json'), 'utf8'));
}

/** evaluates the virtual module's code as a file at `file`, the way the built server would load it */
async function importVirtualModule(code: string, file: string): Promise<VirtualModule> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, code);

  return (await import(pathToFileURL(file).href)) as VirtualModule;
}

beforeEach(() => {
  vi.clearAllMocks();

  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'islands-manifest-plugin-'));
  fs.mkdirSync(path.join(dist, 'server', 'chunks'), { recursive: true });
  runtimeSource = '/* gate runtime */';

  // the gate runtime iife is a build output next to the built plugin, absent next to the source
  const readFileSync = fs.readFileSync.bind(fs);

  vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (file instanceof URL && file.pathname.endsWith(`/${RUNTIME_FILE}`)) return `\n${runtimeSource}\n`;

    return (readFileSync as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof fs.readFileSync);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dist, { recursive: true, force: true });
});

describe('createIslandsManifestPlugin', () => {
  describe('virtual module', () => {
    test('resolves only its own id', () => {
      const hook = createPlugin();
      const resolved = hook('resolveId')(ISLANDS_VIRTUAL_MODULE_ID);

      expect(resolved).toBe(`\0${ISLANDS_VIRTUAL_MODULE_ID}`);
      expect(hook('resolveId')('virtual:@astroscope/node/config')).toBeUndefined();
      expect(hook('load')('\0virtual:@astroscope/node/config')).toBeUndefined();
    });

    test('carries no manifest in dev, only the preload switch', async () => {
      const hook = createPlugin({ preload: false });

      hook('configResolved')({ command: 'serve' });

      const code = hook('load')(`\0${ISLANDS_VIRTUAL_MODULE_ID}`) as string;
      const module = await importVirtualModule(code, path.join(dist, 'dev.mjs'));

      expect(module).toMatchObject({ manifest: null, preload: false });
    });

    test.each([
      ['next to the module', 'server/entry.mjs', 'server/islands-manifest.json'],
      ['in chunks/ below the module', 'server/middleware.mjs', 'server/chunks/islands-manifest.json'],
      ['in chunks/ beside the module directory', 'server/pages/index.mjs', 'server/chunks/islands-manifest.json'],
    ])('a build reads the manifest at runtime: %s', async (_name, modulePath, manifestPath) => {
      const hook = createPlugin();
      const manifest: IslandsManifest = { runtimeSource: 'x', chunks: { '_astro/a.js': {} }, routes: {} };
      // one tree per case: the probing must not see another case's manifest
      const root = fs.mkdtempSync(path.join(dist, 'built-'));

      hook('configResolved')({ command: 'build' });

      fs.mkdirSync(path.dirname(path.join(root, manifestPath)), { recursive: true });
      fs.writeFileSync(path.join(root, manifestPath), JSON.stringify(manifest));

      const code = hook('load')(`\0${ISLANDS_VIRTUAL_MODULE_ID}`) as string;
      const module = await importVirtualModule(code, path.join(root, modulePath));

      expect(module).toMatchObject({ manifest, preload: true });
    });

    test('a build without a manifest on disk loads as null instead of failing', async () => {
      const hook = createPlugin({ preload: false });

      hook('configResolved')({ command: 'build' });

      const code = hook('load')(`\0${ISLANDS_VIRTUAL_MODULE_ID}`) as string;
      const module = await importVirtualModule(code, path.join(dist, 'empty', 'entry.mjs'));

      expect(module).toMatchObject({ manifest: null, preload: false });
    });
  });

  describe('manifest', () => {
    test('records direct static and dynamic edges per chunk, assets left out', () => {
      const hook = createPlugin();

      hook('writeBundle').call(
        client,
        { dir: path.join(dist, 'client') },
        toBundle(
          [
            { fileName: '_astro/Cart.aaa.js', imports: ['_astro/shared.bbb.js'], dynamicImports: ['_astro/Lazy.ccc.js'] },
            { fileName: '_astro/shared.bbb.js' },
            { fileName: '_astro/Lazy.ccc.js', imports: ['_astro/shared.bbb.js'] },
          ],
          ['_astro/index.ddd.css'],
        ),
      );

      expect(readManifest()).toEqual({
        runtimeSource: '/* gate runtime */',
        chunks: {
          '_astro/Cart.aaa.js': { i: ['_astro/shared.bbb.js'], d: ['_astro/Lazy.ccc.js'] },
          '_astro/shared.bbb.js': {},
          '_astro/Lazy.ccc.js': { i: ['_astro/shared.bbb.js'] },
        },
        routes: {},
      });
    });

    test('maps the islands the server build attributed to a route onto their client entry chunks', async () => {
      const hook = createPlugin({
        pages: new Map([
          ['/src/pages/index.astro', ['/', '/[...slug]']],
          ['/src/pages/about.astro', ['/about']],
        ]),
      });

      await hook('generateBundle').call(
        serverContext({
          '/src/pages/index.astro': { imports: ['/src/components/Nav.astro'], hydrated: ['/src/components/Cart.tsx'] },
          '/src/components/Nav.astro': { hydrated: ['/src/components/Menu.tsx'] },
          '/src/pages/about.astro': {},
        }),
      );

      hook('writeBundle').call(
        client,
        { dir: path.join(dist, 'client') },
        toBundle([
          { fileName: '_astro/Cart.aaa.js', isEntry: true, facadeModuleId: '/src/components/Cart.tsx' },
          { fileName: '_astro/Menu.bbb.js', isEntry: true, facadeModuleId: '/src/components/Menu.tsx?v=1' },
          // a shared chunk named after a component is not that component's entry
          { fileName: '_astro/Other.ccc.js', facadeModuleId: '/src/components/Other.tsx' },
        ]),
      );

      expect(readManifest().routes).toEqual({
        '/': ['_astro/Cart.aaa.js', '_astro/Menu.bbb.js'],
        '/[...slug]': ['_astro/Cart.aaa.js', '_astro/Menu.bbb.js'],
        '/about': [],
      });
    });

    test('an island without a client entry chunk is dropped from its route', async () => {
      const hook = createPlugin({ pages: new Map([['/src/pages/index.astro', ['/']]]) });

      await hook('generateBundle').call(
        serverContext({
          '/src/pages/index.astro': { hydrated: ['/src/components/Cart.tsx', '/src/components/Gone.tsx'] },
        }),
      );

      hook('writeBundle').call(
        client,
        { dir: path.join(dist, 'client') },
        toBundle([{ fileName: '_astro/Cart.aaa.js', isEntry: true, facadeModuleId: '/src/components/Cart.tsx' }]),
      );

      expect(readManifest().routes).toEqual({ '/': ['_astro/Cart.aaa.js'] });
    });

    test('the client build contributes no route attribution of its own', async () => {
      const hook = createPlugin({ pages: new Map([['/src/pages/index.astro', ['/']]]) });
      const graph = serverContext({ '/src/pages/index.astro': { hydrated: ['/src/components/Cart.tsx'] } });

      await hook('generateBundle').call({ ...graph, environment: { name: 'client' } });

      hook('writeBundle').call(client, { dir: path.join(dist, 'client') }, toBundle([]));

      expect(readManifest().routes).toEqual({});
    });

    test('is written by the client build only', () => {
      const hook = createPlugin();
      const bundle = toBundle([{ fileName: 'entry.mjs' }]);

      hook('writeBundle').call({ environment: { name: 'ssr' } }, { dir: path.join(dist, 'server') }, bundle);
      hook('writeBundle').call({ environment: { name: 'prerender' } }, { dir: path.join(dist, 'client') }, bundle);
      hook('writeBundle').call(client, {}, bundle);

      expect(fs.existsSync(path.join(dist, 'server', 'chunks', 'islands-manifest.json'))).toBe(false);
    });

    test('refuses a gate runtime that would close the inline script it is embedded in', () => {
      const hook = createPlugin();

      runtimeSource = 'const tag = "</SCRIPT>";';

      expect(() => hook('writeBundle').call(client, { dir: path.join(dist, 'client') }, toBundle([]))).toThrow(
        '</script',
      );
      expect(fs.existsSync(path.join(dist, 'server', 'chunks', 'islands-manifest.json'))).toBe(false);
    });

    test('warns instead of failing when the server chunks directory is missing', () => {
      const hook = createPlugin();

      fs.rmSync(path.join(dist, 'server'), { recursive: true });

      hook('writeBundle').call(client, { dir: path.join(dist, 'client') }, toBundle([]));

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(path.join(dist, 'server', 'chunks')));
      expect(fs.existsSync(path.join(dist, 'server'))).toBe(false);
    });
  });
});
