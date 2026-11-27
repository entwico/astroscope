import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AstroIntegrationLogger } from 'astro';
import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ConsistencyCheckLevel } from '../integration/types.js';
import { getManifest } from './manifest.js';
import { i18nVitePlugin } from './vite-plugin.js';

type TransformHook = (this: unknown, code: string, id: string) => Promise<{ code: string; map?: string } | null>;
type GenerateBundleHook = (this: unknown, options: unknown, bundle: Record<string, unknown>) => void;
type LoadHook = (this: unknown, id: string) => string | undefined;

type TestPlugin = Plugin & {
  configResolved: (config: unknown) => void;
  configureServer: (server: unknown) => Promise<void>;
  resolveId: (this: unknown, id: string) => string | undefined;
  transform: TransformHook;
  generateBundle: GenerateBundleHook;
  writeBundle: (this: unknown, options: { dir?: string | undefined }) => void;
  load: LoadHook;
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as AstroIntegrationLogger;

const SOURCE = `
  import { t } from '@astroscope/i18n/translate';
  export function Cart() {
    return t('cart.title', 'Cart');
  }
`;

const ORIGINAL_MAP = {
  version: 3,
  file: 'Cart.Cabc.js',
  sources: ['../src/Cart.tsx'],
  sourcesContent: [SOURCE],
  names: [],
  mappings: 'AAAA,CAAC;AACA',
  toString: () => 'original',
  toUrl: () => 'data:original',
};

const DYNAMIC_SOURCE = `
  import { t } from '@astroscope/i18n/translate';
  export const greet = (name) => t('greeting', \`Hello \${name}\`);
`;

// the transform hook reads the combined source map only to map error positions; none means "as reported"
const transformContext = { getCombinedSourcemap: () => null };

function createPlugin(
  options: {
    command?: 'build' | 'serve' | undefined;
    consistency?: ConsistencyCheckLevel | undefined;
    root?: string | undefined;
  } = {},
): TestPlugin {
  const plugin = i18nVitePlugin({
    logger,
    consistency: options.consistency ?? 'off',
    exclude: null,
    base: '/',
  }) as TestPlugin;

  plugin.configResolved({ root: options.root ?? '/root', command: options.command ?? 'build' });

  return plugin;
}

function createChunk(fileName: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'chunk',
    fileName,
    moduleIds: [] as string[],
    imports: [] as string[],
    dynamicImports: [] as string[],
    isEntry: false,
    isDynamicEntry: false,
    facadeModuleId: null as string | null,
    code: 'export const a = 1;\n',
    map: null,
    ...overrides,
  };
}

function bundleOf(...chunks: { fileName: string }[]): Record<string, unknown> {
  return Object.fromEntries(chunks.map((chunk) => [chunk.fileName, chunk]));
}

let tempDirs: string[] = [];

function createTempDir(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-plugin-'));

  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));

  tempDirs = [];
});

async function generate(options: { base: string; sourcemap: boolean | 'inline' }) {
  const plugin = i18nVitePlugin({ logger, consistency: 'off', exclude: null, base: options.base }) as Plugin & {
    configResolved: (config: unknown) => void;
    transform: TransformHook;
    generateBundle: GenerateBundleHook;
    load: LoadHook;
  };
  const file = '/root/src/Cart.tsx';

  plugin.configResolved({ root: '/root', command: 'build' });

  await plugin.transform.call({}, SOURCE, file);

  const chunk = {
    type: 'chunk',
    fileName: '_astro/Cart.Cabc.js',
    sourcemapFileName: '_astro/Cart.Cabc.js.map',
    moduleIds: [file],
    imports: [],
    dynamicImports: [],
    isEntry: false,
    isDynamicEntry: false,
    facadeModuleId: file,
    code: 'export const a = 1;\n',
    map: options.sourcemap ? { ...ORIGINAL_MAP } : null,
  };
  const mapAsset = { type: 'asset', fileName: '_astro/Cart.Cabc.js.map', source: 'original' };
  const bundle: Record<string, unknown> = { [chunk.fileName]: chunk, [mapAsset.fileName]: mapAsset };

  plugin.generateBundle.call({}, { sourcemap: options.sourcemap }, bundle);

  return { plugin, chunk, mapAsset };
}

describe('i18n vite plugin', () => {
  test('exposes the chunk prefix under base to the middleware config', async () => {
    const { plugin } = await generate({ base: '/docs/', sourcemap: false });

    expect(plugin.load.call({}, '\0virtual:@astroscope/i18n/config')).toContain(
      'export const chunkPrefix = "/docs/_i18n/";',
    );
  });

  test('injects a loader fetching the chunk under base', async () => {
    const { chunk } = await generate({ base: '/docs', sourcemap: false });

    expect(chunk.code).toMatch(/^if\(typeof window!=='undefined'&&window\.__i18n__\)\{/);
    expect(chunk.code).toContain('await import("/docs/_i18n/"+_.locale+"/Cart.Cabc."+h+".js")');
    expect(chunk.code.endsWith('}\nexport const a = 1;\n')).toBe(true);
  });

  test('moves the source map down by the loader line, in the chunk and its map asset', async () => {
    const { chunk, mapAsset } = await generate({ base: '/', sourcemap: true });
    const emitted = JSON.parse(mapAsset.source) as typeof ORIGINAL_MAP;

    expect(chunk.map?.mappings).toBe(';AAAA,CAAC;AACA');
    expect(emitted.mappings).toBe(';AAAA,CAAC;AACA');
    expect(emitted.sources).toEqual(ORIGINAL_MAP.sources);
    expect(emitted.sourcesContent).toEqual(ORIGINAL_MAP.sourcesContent);
    expect(chunk.map?.toString()).toBe(mapAsset.source);
  });

  test('rewrites an inline source map comment', async () => {
    const { chunk, mapAsset } = await generate({ base: '/', sourcemap: 'inline' });
    const comment = chunk.code.slice(chunk.code.lastIndexOf('\n//# sourceMappingURL=') + 1);
    const encoded = comment.replace('//# sourceMappingURL=data:application/json;charset=utf-8;base64,', '');
    const inlined = JSON.parse(Buffer.from(encoded, 'base64').toString()) as typeof ORIGINAL_MAP;

    expect(inlined.mappings).toBe(';AAAA,CAAC;AACA');
    expect(mapAsset.source).toBe('original');
  });

  test('leaves a chunk without t() modules untouched', () => {
    const plugin = createPlugin();
    const chunk = createChunk('_astro/Plain.Cabc.js', { moduleIds: ['/root/src/Plain.tsx'] });

    plugin.generateBundle.call({}, { sourcemap: false }, bundleOf(chunk));

    expect(chunk.code).toBe('export const a = 1;\n');
    expect(getManifest().chunks).toEqual({});
  });
});

describe('virtual modules', () => {
  test('resolves the manifest module, with or without a query, and the config module', () => {
    const plugin = createPlugin();

    expect(plugin.resolveId.call({}, 'virtual:@astroscope/i18n/manifest')).toBe('\0virtual:@astroscope/i18n/manifest');
    expect(plugin.resolveId.call({}, 'virtual:@astroscope/i18n/manifest?v=1')).toBe(
      '\0virtual:@astroscope/i18n/manifest?v=1',
    );
    expect(plugin.resolveId.call({}, 'virtual:@astroscope/i18n/config')).toBe('\0virtual:@astroscope/i18n/config');
  });

  test('leaves foreign ids to other resolvers', () => {
    const plugin = createPlugin();

    expect(plugin.resolveId.call({}, 'virtual:@astroscope/i18n/other')).toBeUndefined();
    expect(plugin.resolveId.call({}, './manifest.js')).toBeUndefined();
    expect(plugin.load.call({}, '/root/src/Cart.tsx')).toBeUndefined();
  });

  test('the build manifest module reads the emitted json next to itself at runtime', () => {
    const plugin = createPlugin({ command: 'build' });

    for (const id of ['\0virtual:@astroscope/i18n/manifest', '\0virtual:@astroscope/i18n/manifest?v=1']) {
      const code = plugin.load.call({}, id);

      expect(code).toContain('readFileSync(join(__dirname, \'i18n-manifest.json\')');
      expect(code).not.toContain('@astroscope/i18n/extraction');
    }
  });

  test('the dev manifest module delegates to the live extraction state', () => {
    const plugin = createPlugin({ command: 'serve' });
    const code = plugin.load.call({}, '\0virtual:@astroscope/i18n/manifest');

    expect(code).toContain('import { getManifest as _getManifest } from \'@astroscope/i18n/extraction\'');
    expect(code).not.toContain('readFileSync');
  });

  test('the config module carries regexp exclude patterns as code', async () => {
    const plugin = i18nVitePlugin({
      logger,
      consistency: 'off',
      exclude: [{ pattern: /^\/api\// }, { prefix: '/health' }],
      base: '/',
    }) as TestPlugin;
    const code = plugin.load.call({}, '\0virtual:@astroscope/i18n/config')!;
    const module = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as { exclude: unknown };

    expect(module.exclude).toEqual([{ pattern: /^\/api\// }, { prefix: '/health' }]);
  });

  test('the config module exports a null exclude for the default', async () => {
    const code = createPlugin().load.call({}, '\0virtual:@astroscope/i18n/config')!;
    const module = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as { exclude: unknown };

    expect(module.exclude).toBeNull();
  });
});

describe('transform', () => {
  test('skips files that cannot contain t() calls', async () => {
    const plugin = createPlugin();
    const skipped = {
      '/root/src/styles.css': SOURCE,
      '/root/node_modules/pkg/Cart.tsx': SOURCE,
      '/root/src/Plain.tsx': 'export const a = 1;',
    };

    for (const [file, code] of Object.entries(skipped)) {
      expect(await plugin.transform.call(transformContext, code, file)).toBeNull();
    }

    const chunk = createChunk('_astro/Cart.Cabc.js', { moduleIds: Object.keys(skipped) });

    plugin.generateBundle.call({}, { sourcemap: false }, bundleOf(chunk));

    expect(chunk.code).toBe('export const a = 1;\n');
  });

  test('a build strips the fallback and returns the map as a string', async () => {
    const plugin = createPlugin({ command: 'build' });
    const result = await plugin.transform.call(transformContext, SOURCE, '/root/src/Cart.tsx');

    expect(result?.code).toContain('t(\'cart.title\')');
    expect(result?.code).not.toContain('\'Cart\'');
    expect(typeof result?.map).toBe('string');
  });

  test('dev keeps the source and publishes the keys with project-relative locations', async () => {
    const plugin = createPlugin({ command: 'serve' });

    expect(await plugin.transform.call(transformContext, SOURCE, '/root/src/Cart.tsx')).toBeNull();
    expect(getManifest().keys).toEqual([{ key: 'cart.title', meta: { fallback: 'Cart' }, files: ['src/Cart.tsx:4'] }]);
  });

  test('dev warns about a fallback that cannot be read at build time', async () => {
    const plugin = createPlugin({ command: 'serve' });

    await plugin.transform.call(transformContext, DYNAMIC_SOURCE, '/root/src/greet.ts');

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'src/greet.ts:3:34 — t(\'greeting\') the fallback is a template literal with expressions',
    );
  });

  test('a build does not warn, the bundle is the gate', async () => {
    const plugin = createPlugin({ command: 'build' });

    await plugin.transform.call(transformContext, DYNAMIC_SOURCE, '/root/src/greet.ts');

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('build gates', () => {
  test('fails the build listing every t() call whose fallback cannot be read', async () => {
    const plugin = createPlugin({ command: 'build' });

    await plugin.transform.call(transformContext, DYNAMIC_SOURCE, '/root/src/greet.ts');
    await plugin.transform.call(
      transformContext,
      DYNAMIC_SOURCE.replace('greeting', 'farewell'),
      '/root/src/nested/bye.ts',
    );

    const run = () => plugin.generateBundle.call({}, { sourcemap: false }, {});

    expect(run).toThrow('i18n: 2 t() call(s) have a fallback that cannot be read at build time.');
    expect(run).toThrow('  - src/greet.ts:3:34 — t(\'greeting\') the fallback is a template literal with expressions');
    expect(run).toThrow('  - src/nested/bye.ts:3:34 — t(\'farewell\')');
  });

  test('a file fixed since its last transform no longer fails the build', async () => {
    const plugin = createPlugin({ command: 'build' });

    await plugin.transform.call(transformContext, DYNAMIC_SOURCE, '/root/src/greet.ts');
    await plugin.transform.call(transformContext, SOURCE, '/root/src/greet.ts');

    expect(() => plugin.generateBundle.call({}, { sourcemap: false }, {})).not.toThrow();
  });

  test.each([
    { consistency: 'error', fails: true },
    { consistency: 'warn', fails: false },
    { consistency: 'off', fails: false },
  ] as const)('consistency $consistency: a key with two fallbacks fails the build = $fails', async (options) => {
    const plugin = createPlugin({ command: 'build', consistency: options.consistency });

    await plugin.transform.call(transformContext, SOURCE, '/root/src/Cart.tsx');
    await plugin.transform.call(transformContext, SOURCE.replace('\'Cart\'', '\'Basket\''), '/root/src/Mini.tsx');

    const run = () => plugin.generateBundle.call({}, { sourcemap: false }, {});

    if (options.fails) {
      expect(run).toThrow('i18n: build failed due to translation key inconsistencies');
    } else {
      expect(run).not.toThrow();
    }
  });
});

describe('script chunks', () => {
  const SCRIPT_ID = '/root/src/pages/index.astro?astro&type=script&index=0&lang.ts';

  async function scriptsOf(chunks: ReturnType<typeof createChunk>[], sources: Record<string, string>) {
    const plugin = createPlugin({ command: 'build' });

    for (const [file, code] of Object.entries(sources)) {
      await plugin.transform.call(transformContext, code, file);
    }

    plugin.generateBundle.call({}, { sourcemap: false }, bundleOf(...chunks));

    return getManifest().scripts.toSorted((a, b) => a.localeCompare(b));
  }

  test('collects the i18n chunks a script entry reaches through static and dynamic imports', async () => {
    const scripts = await scriptsOf(
      [
        createChunk('_astro/index.astro_astro_type_script.Caaa.js', {
          isEntry: true,
          facadeModuleId: SCRIPT_ID,
          moduleIds: [SCRIPT_ID],
          imports: ['_astro/shared.Cbbb.js'],
        }),
        // no keys of its own, only a hop towards the lazy chunk
        createChunk('_astro/shared.Cbbb.js', { dynamicImports: ['_astro/lazy.Cccc.js'] }),
        createChunk('_astro/lazy.Cccc.js', { moduleIds: ['/root/src/lazy.ts'] }),
        createChunk('_astro/Island.Cddd.js', { isEntry: true, moduleIds: ['/root/src/Island.tsx'] }),
      ],
      {
        '/root/src/lazy.ts': SOURCE.replace('cart.title', 'lazy.text'),
        '/root/src/Island.tsx': SOURCE,
      },
    );

    expect(scripts).toEqual(['lazy.Cccc']);
  });

  test('includes the script entry itself when it translates', async () => {
    const scripts = await scriptsOf(
      [createChunk('_astro/page.Caaa.js', { isDynamicEntry: true, facadeModuleId: SCRIPT_ID, moduleIds: [SCRIPT_ID] })],
      { [SCRIPT_ID]: SOURCE },
    );

    expect(scripts).toEqual(['page.Caaa']);
  });

  test('terminates on circular chunk imports and counts a shared chunk once', async () => {
    const scripts = await scriptsOf(
      [
        createChunk('_astro/one.Caaa.js', {
          isEntry: true,
          facadeModuleId: SCRIPT_ID,
          imports: ['_astro/shared.Cccc.js'],
        }),
        createChunk('_astro/two.Cbbb.js', {
          isEntry: true,
          facadeModuleId: 'astro:scripts/page.js',
          imports: ['_astro/shared.Cccc.js'],
        }),
        createChunk('_astro/shared.Cccc.js', {
          moduleIds: ['/root/src/shared.ts'],
          imports: ['_astro/one.Caaa.js'],
        }),
      ],
      { '/root/src/shared.ts': SOURCE },
    );

    expect(scripts).toEqual(['shared.Cccc']);
  });

  test('is empty when only islands translate', async () => {
    const scripts = await scriptsOf(
      [createChunk('_astro/Island.Cddd.js', { isEntry: true, moduleIds: ['/root/src/Island.tsx'] })],
      { '/root/src/Island.tsx': SOURCE },
    );

    expect(scripts).toEqual([]);
  });
});

describe('configureServer', () => {
  test('dev scans the project up front and warns about non-extractable fallbacks', async () => {
    const root = createTempDir({ 'src/Cart.tsx': SOURCE, 'src/greet.ts': DYNAMIC_SOURCE });
    const plugin = createPlugin({ command: 'serve', root });

    await plugin.configureServer({ config: { isProduction: false } });

    expect(getManifest().keys.map((key) => key.key).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'cart.title',
      'greeting',
    ]);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith('dev mode: scanned 2 files, found 2 keys');
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'src/greet.ts:3:34 — t(\'greeting\') the fallback is a template literal with expressions',
    );
  });

  test.each([
    { name: 'a build', command: 'build', isProduction: false },
    { name: 'a production server', command: 'serve', isProduction: true },
  ] as const)('$name does not scan', async ({ command, isProduction }) => {
    const root = createTempDir({ 'src/Cart.tsx': SOURCE.replace('cart.title', 'never.scanned') });
    const plugin = createPlugin({ command, root });

    await plugin.configureServer({ config: { isProduction } });

    expect(getManifest().keys.map((key) => key.key)).not.toContain('never.scanned');
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('writeBundle', () => {
  async function createBuiltPlugin() {
    const plugin = createPlugin({ command: 'build' });

    await plugin.transform.call(transformContext, SOURCE, '/root/src/Cart.tsx');

    plugin.generateBundle.call(
      {},
      { sourcemap: false },
      bundleOf(createChunk('_astro/Cart.Cabc.js', { moduleIds: ['/root/src/Cart.tsx'] })),
    );

    return plugin;
  }

  test('the client build writes the manifest next to the server chunks', async () => {
    const dist = createTempDir({ 'server/chunks/.keep': '' });
    const plugin = await createBuiltPlugin();

    plugin.writeBundle.call({ environment: { name: 'client' } }, { dir: path.join(dist, 'client') });

    const written = JSON.parse(fs.readFileSync(path.join(dist, 'server', 'chunks', 'i18n-manifest.json'), 'utf8'));

    expect(written).toEqual({
      keys: [{ key: 'cart.title', meta: { fallback: 'Cart' }, files: ['src/Cart.tsx:4'] }],
      chunks: { 'Cart.Cabc': ['cart.title'] },
      scripts: [],
    });
    expect(fs.existsSync(path.join(dist, 'client'))).toBe(false);
  });

  test('the server build and a build without an output directory write nothing', async () => {
    const dist = createTempDir({ 'server/chunks/.keep': '' });
    const plugin = await createBuiltPlugin();

    plugin.writeBundle.call({ environment: { name: 'ssr' } }, { dir: path.join(dist, 'server') });
    plugin.writeBundle.call({ environment: { name: 'client' } }, {});

    expect(fs.readdirSync(path.join(dist, 'server', 'chunks'))).toEqual(['.keep']);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('reports a missing server chunks directory instead of creating it', async () => {
    const dist = createTempDir();
    const plugin = await createBuiltPlugin();

    plugin.writeBundle.call({ environment: { name: 'client' } }, { dir: path.join(dist, 'client') });

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      `server chunks directory not found, cannot write manifest to ${path.join(dist, 'server', 'chunks', 'i18n-manifest.json')}`,
    );
    expect(fs.existsSync(path.join(dist, 'server'))).toBe(false);
  });
});
