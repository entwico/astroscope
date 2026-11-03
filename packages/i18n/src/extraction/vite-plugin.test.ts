import type { AstroIntegrationLogger } from 'astro';
import type { Plugin } from 'vite';
import { describe, expect, test, vi } from 'vitest';
import { i18nVitePlugin } from './vite-plugin.js';

type TransformHook = (this: unknown, code: string, id: string) => Promise<{ code: string } | null>;
type GenerateBundleHook = (this: unknown, options: unknown, bundle: Record<string, unknown>) => void;
type LoadHook = (this: unknown, id: string) => string | undefined;

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
});
