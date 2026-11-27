import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as islands from '@astroscope/node/islands';
import type { Plugin } from 'vite';
import { afterEach, describe, expect, test, vi } from 'vitest';
import wormholeIntegration from './integration';

const mocks = vi.hoisted(() => ({
  pages: undefined as Map<string, string[]> | undefined,
}));

vi.mock('@astroscope/node/islands', async (importOriginal) => ({
  ...(await importOriginal<typeof islands>()),
  collectRouteIslands: (_context: unknown, pages: Map<string, string[]>) => {
    mocks.pages = pages;

    return Promise.resolve({ routes: new Map(), patternsByModule: new Map() });
  },
}));

type Hook = (this: unknown, ...args: unknown[]) => unknown;

const REGISTRY_ID = 'virtual:@astroscope/wormhole/registry';

let roots: string[] = [];

function createProject(files: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wormhole-integration-'));

  roots.push(root);

  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'export const wormholes = {};');
  }

  const config = {
    root: pathToFileURL(`${root}${path.sep}`),
    srcDir: pathToFileURL(`${path.join(root, 'src')}${path.sep}`),
  };

  return { root, config };
}

function setup(files: string[], options?: Parameters<typeof wormholeIntegration>[0]) {
  const { root, config } = createProject(files);
  const integration = wormholeIntegration(options);
  const hook = (name: string) => (integration.hooks as Record<string, unknown>)[name] as Hook;
  const addMiddleware = vi.fn();
  const updateConfig = vi.fn();

  hook('astro:config:setup')({ config, updateConfig, addMiddleware });

  const plugin = (updateConfig.mock.calls[0]?.[0] as { vite: { plugins: Plugin[] } }).vite.plugins[0]!;
  const pluginHook = (name: string) => plugin[name as keyof Plugin] as unknown as Hook;

  return { root, config, hook, addMiddleware, pluginHook };
}

function configDone(context: ReturnType<typeof setup>, stubFile?: string) {
  const logger = { warn: vi.fn(), error: vi.fn() };
  const expected = path.join(context.root, '.astro', 'integrations', '_astroscope_wormhole', 'registry.d.ts');
  const injectTypes = vi.fn((_types: { filename: string; content: string }) => pathToFileURL(stubFile ?? expected));

  context.hook('astro:config:done')({ config: context.config, injectTypes, logger });

  return { logger, injectTypes };
}

afterEach(() => {
  roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));

  roots = [];
  mocks.pages = undefined;
});

describe('wormhole integration', () => {
  test('runs its middleware after the project middleware', () => {
    const { addMiddleware } = setup([]);

    expect(addMiddleware).toHaveBeenCalledExactlyOnceWith({
      order: 'post',
      entrypoint: '@astroscope/wormhole/middleware',
    });
  });

  test.each([
    { name: 'src/wormholes.ts', files: ['src/wormholes.ts'], registry: 'src/wormholes.ts' },
    { name: 'src/wormholes/index.ts', files: ['src/wormholes/index.ts'], registry: 'src/wormholes/index.ts' },
    {
      name: 'src/wormholes.ts over the directory form',
      files: ['src/wormholes/index.ts', 'src/wormholes.ts'],
      registry: 'src/wormholes.ts',
    },
  ])('resolves the registry module to $name', ({ files, registry }) => {
    const { root, pluginHook } = setup(files);

    expect(pluginHook('resolveId').call({}, REGISTRY_ID)).toBe(path.join(root, registry));
  });

  test('a project without a registry gets the empty stub', () => {
    const { pluginHook } = setup(['src/other.ts']);
    const id = pluginHook('resolveId').call({}, REGISTRY_ID) as string;

    expect(pluginHook('load').call({ environment: { name: 'ssr' } }, id)).toBe('export const wormholes = {};');
  });

  test('hands the exclude patterns to the middleware config', () => {
    const { pluginHook } = setup([], { exclude: [{ prefix: '/api/' }] });
    const id = pluginHook('resolveId').call({}, 'virtual:@astroscope/wormhole/config') as string;

    expect(pluginHook('load').call({ environment: { name: 'ssr' } }, id)).toContain('/api/');
  });

  test('the server build walks the routes resolved after setup, from the project root', async () => {
    const { root, hook, pluginHook } = setup([]);

    hook('astro:routes:resolved')({
      routes: [
        { type: 'page', pattern: '/', entrypoint: 'src/pages/index.astro' },
        { type: 'endpoint', pattern: '/api/cart', entrypoint: 'src/pages/api/cart.ts' },
        { type: 'redirect', pattern: '/old', entrypoint: 'src/pages/old.astro' },
      ],
    });
    pluginHook('configResolved')({ command: 'build' });

    await pluginHook('generateBundle').call({ environment: { name: 'ssr' } });

    expect(mocks.pages).toEqual(
      new Map([
        [path.join(root, 'src/pages/index.astro'), ['/']],
        [path.join(root, 'src/pages/api/cart.ts'), ['/api/cart']],
      ]),
    );
  });
});

describe('registry type stub', () => {
  test.each([
    { name: 'src/wormholes.ts', file: 'src/wormholes.ts' },
    { name: 'src/wormholes/index.ts', file: 'src/wormholes/index.ts' },
  ])('types the proxy from $name through an extensionless import relative to the stub', ({ file }) => {
    const { injectTypes, logger } = configDone(setup([file]));

    expect(injectTypes).toHaveBeenCalledOnce();

    const stub = injectTypes.mock.calls[0]![0];

    expect(stub.filename).toBe('registry.d.ts');
    expect(stub.content).toContain(
      'interface WormholeRegistry extends UnwrapWormholes<typeof import("../../../src/wormholes").wormholes> {}',
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('warns and injects nothing without a registry', () => {
    const { injectTypes, logger } = configDone(setup([]));

    expect(injectTypes).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'no src/wormholes.ts registry found — the wormholes proxy stays untyped',
    );
  });

  test('reports a stub astro wrote somewhere its relative import does not hold', () => {
    const context = setup(['src/wormholes.ts']);
    const elsewhere = path.join(context.root, '.astro', 'types', 'registry.d.ts');
    const { logger } = configDone(context, elsewhere);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0]?.[0]).toContain(`registry type stub landed at ${elsewhere} instead of the expected`);
  });
});
