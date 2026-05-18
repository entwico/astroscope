import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IntegrationResolvedRoute } from 'astro';
import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ASTRO_MIDDLEWARE_VIRTUAL, RESOLVED_VIRTUAL_MODULE_ID, VIRTUAL_MODULE_ID } from './warmup/warmup';
import boot from './index';

type RouteShape = Pick<IntegrationResolvedRoute, 'type' | 'isPrerendered' | 'entrypoint'>;

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'astroscope-boot-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function touch(rel: string): string {
  const abs = path.join(projectRoot, rel);

  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, '');

  return abs;
}

function setupIntegration(opts: { warmup?: boolean | undefined } = {}) {
  const integration = boot({ ...(opts.warmup === undefined ? {} : { warmup: opts.warmup }) });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const plugins: Plugin[] = [];

  const setup = integration.hooks['astro:config:setup'];

  if (!setup) throw new Error('integration missing astro:config:setup');

  setup({
    command: 'build',
    updateConfig: ((c: { vite?: { plugins?: Plugin[] } }) => {
      for (const p of c.vite?.plugins ?? []) plugins.push(p);
    }) as never,
    logger: logger as never,
    config: { root: pathToFileURL(`${projectRoot}/`) } as never,
  } as never);

  const buildPlugin = plugins.find((p) => p.name === '@astroscope/boot');

  if (!buildPlugin) throw new Error('build plugin not registered');

  const fireRoutesResolved = (routes: RouteShape[]): void => {
    const handler = integration.hooks['astro:routes:resolved'];

    if (!handler) throw new Error('integration missing astro:routes:resolved');

    void handler({ routes: routes as never, logger: logger as never });
  };

  return { integration, buildPlugin, logger, fireRoutesResolved };
}

function createSsrBuildContext() {
  const emitFile = vi.fn(({ name }: { name: string }) => `__ref_${name}`);
  const getFileName = vi.fn((ref: string) => `${ref.replace('__ref_', '')}.mjs`);
  const ctx = {
    environment: { name: 'ssr' },
    emitFile,
    getFileName,
  };

  return { ctx, emitFile, getFileName };
}

describe('build plugin — astro:routes:resolved → buildStart wiring', () => {
  test('emits a warmup chunk and writes specifiers including non-prerendered routes + middleware', async () => {
    const indexAbs = touch('src/pages/index.astro');
    const apiAbs = touch('src/pages/api.ts');
    touch('src/pages/static.astro');

    const { buildPlugin, fireRoutesResolved, logger } = setupIntegration();

    fireRoutesResolved([
      { type: 'page', isPrerendered: false, entrypoint: 'src/pages/index.astro' },
      { type: 'endpoint', isPrerendered: false, entrypoint: 'src/pages/api.ts' },
      { type: 'page', isPrerendered: true, entrypoint: 'src/pages/static.astro' },
    ]);

    const { ctx, emitFile } = createSsrBuildContext();
    const buildStart = buildPlugin.buildStart as never as (this: typeof ctx) => Promise<void>;

    await buildStart.call(ctx);

    const emitted = emitFile.mock.calls.map((args) => args[0]);
    expect(emitted).toContainEqual(expect.objectContaining({ name: 'boot' }));
    expect(emitted).toContainEqual(expect.objectContaining({ name: 'warmup', id: VIRTUAL_MODULE_ID }));

    const load = buildPlugin.load as never as (id: string) => string | undefined;
    const code = load(RESOLVED_VIRTUAL_MODULE_ID)!;

    expect(code).toContain(`import(${JSON.stringify(indexAbs)})`);
    expect(code).toContain(`import(${JSON.stringify(apiAbs)})`);
    expect(code).not.toContain(`static.astro`);
    expect(code).toContain(`import("${ASTRO_MIDDLEWARE_VIRTUAL}")`);

    expect(logger.info).toHaveBeenCalledWith('warmup: 3 modules');
  });

  test('skips synthetic entrypoints that have no real file on disk', async () => {
    const indexAbs = touch('src/pages/index.astro');

    const { buildPlugin, fireRoutesResolved, logger } = setupIntegration();

    fireRoutesResolved([
      { type: 'page', isPrerendered: false, entrypoint: '_server-islands.astro' },
      { type: 'page', isPrerendered: false, entrypoint: 'astro-default-404.astro' },
      { type: 'page', isPrerendered: false, entrypoint: 'src/pages/index.astro' },
    ]);

    const { ctx } = createSsrBuildContext();

    await (buildPlugin.buildStart as never as (this: typeof ctx) => Promise<void>).call(ctx);

    const code = (buildPlugin.load as never as (id: string) => string)(RESOLVED_VIRTUAL_MODULE_ID);

    expect(code).toContain(`import(${JSON.stringify(indexAbs)})`);
    expect(code).not.toContain('_server-islands');
    expect(code).not.toContain('astro-default-404');
    expect(logger.info).toHaveBeenCalledWith('warmup: 2 modules');
  });

  test('still warms middleware when there are no SSR routes (all prerendered)', async () => {
    touch('src/pages/static-1.astro');
    touch('src/pages/static-2.astro');

    const { buildPlugin, fireRoutesResolved } = setupIntegration();

    fireRoutesResolved([
      { type: 'page', isPrerendered: true, entrypoint: 'src/pages/static-1.astro' },
      { type: 'page', isPrerendered: true, entrypoint: 'src/pages/static-2.astro' },
    ]);

    const { ctx, emitFile } = createSsrBuildContext();

    await (buildPlugin.buildStart as never as (this: typeof ctx) => Promise<void>).call(ctx);

    expect(emitFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'warmup' }));

    const code = (buildPlugin.load as never as (id: string) => string)(RESOLVED_VIRTUAL_MODULE_ID);

    expect(code).toContain(`import("${ASTRO_MIDDLEWARE_VIRTUAL}")`);
    expect(code).not.toContain('static-1.astro');
  });

  test('skips warmup chunk emission and produces empty virtual module when warmup is disabled', async () => {
    touch('src/pages/index.astro');

    const { buildPlugin, fireRoutesResolved, logger } = setupIntegration({ warmup: false });

    fireRoutesResolved([{ type: 'page', isPrerendered: false, entrypoint: 'src/pages/index.astro' }]);

    const { ctx, emitFile } = createSsrBuildContext();

    await (buildPlugin.buildStart as never as (this: typeof ctx) => Promise<void>).call(ctx);

    const emittedNames = emitFile.mock.calls.map((args) => (args[0] as { name: string }).name);
    expect(emittedNames).toContain('boot');
    expect(emittedNames).not.toContain('warmup');

    const code = (buildPlugin.load as never as (id: string) => string)(RESOLVED_VIRTUAL_MODULE_ID);

    expect(code).toBe('');
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('warmup:'));
  });

  test('skips entirely when not in the SSR vite environment (e.g. client build)', async () => {
    touch('src/pages/index.astro');

    const { buildPlugin, fireRoutesResolved } = setupIntegration();

    fireRoutesResolved([{ type: 'page', isPrerendered: false, entrypoint: 'src/pages/index.astro' }]);

    const emitFile = vi.fn();
    const ctx = { environment: { name: 'client' }, emitFile, getFileName: vi.fn() };

    await (buildPlugin.buildStart as never as (this: typeof ctx) => Promise<void>).call(ctx);

    expect(emitFile).not.toHaveBeenCalled();
  });

  test('warmup defaults to enabled when option is omitted', async () => {
    touch('src/pages/index.astro');

    const { buildPlugin, fireRoutesResolved } = setupIntegration();

    fireRoutesResolved([{ type: 'page', isPrerendered: false, entrypoint: 'src/pages/index.astro' }]);

    const { ctx, emitFile } = createSsrBuildContext();

    await (buildPlugin.buildStart as never as (this: typeof ctx) => Promise<void>).call(ctx);

    const emittedNames = emitFile.mock.calls.map((args) => (args[0] as { name: string }).name);
    expect(emittedNames).toContain('warmup');
  });
});

describe('build plugin — generateBundle injection', () => {
  test('prepends boot setup and warmup imports into entry.mjs', async () => {
    touch('src/pages/index.astro');

    const { buildPlugin, fireRoutesResolved } = setupIntegration();

    fireRoutesResolved([{ type: 'page', isPrerendered: false, entrypoint: 'src/pages/index.astro' }]);

    const { ctx } = createSsrBuildContext();

    await (buildPlugin.buildStart as never as (this: typeof ctx) => Promise<void>).call(ctx);

    const entryCode = '// astro entry\nstartServer();';
    const bundle: Record<string, { type: string; code: string; map?: unknown }> = {
      'entry.mjs': { type: 'chunk', code: entryCode },
    };

    (buildPlugin.generateBundle as never as (this: typeof ctx, _: unknown, b: typeof bundle) => void).call(
      ctx,
      {},
      bundle,
    );

    const out = bundle['entry.mjs']!.code;

    expect(out).toContain(`import('./warmup.mjs')`);
    expect(out).toContain(`import * as __astroscope_boot from './boot.mjs'`);
    expect(out).toContain(`@astroscope/boot/setup`);
    expect(out).toContain(`await __astroscope_warmup`);
    // original code preserved, not replaced
    expect(out).toContain('// astro entry');
    expect(out).toContain('startServer();');
  });

  test('skips warmup import when warmup is disabled', async () => {
    touch('src/pages/index.astro');

    const { buildPlugin, fireRoutesResolved } = setupIntegration({ warmup: false });

    fireRoutesResolved([{ type: 'page', isPrerendered: false, entrypoint: 'src/pages/index.astro' }]);

    const { ctx } = createSsrBuildContext();

    await (buildPlugin.buildStart as never as (this: typeof ctx) => Promise<void>).call(ctx);

    const bundle: Record<string, { type: string; code: string }> = {
      'entry.mjs': { type: 'chunk', code: '// astro entry' },
    };

    (buildPlugin.generateBundle as never as (this: typeof ctx, _: unknown, b: typeof bundle) => void).call(
      ctx,
      {},
      bundle,
    );

    const out = bundle['entry.mjs']!.code;

    expect(out).toContain(`@astroscope/boot/setup`);
    expect(out).not.toContain(`__astroscope_warmup`);
  });
});
