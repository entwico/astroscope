import fs from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { brotliDecompressSync } from 'node:zlib';
import type { AstroConfig, AstroIntegration } from 'astro';
import { sharpImageService } from 'astro/config';
import pino from 'pino';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { RECOMMENDED_EXCLUDES } from '../excludes/index';
import { getLogStore } from '../observability/log/store';
import { OTEL_REDACTED_QUERY_PARAMS } from '../observability/redact-query';
import { clearNativeMounts, mountNativeHandler } from '../server/native-mount';
import type { NodeOptions, RuntimeOptions } from '../types';
import node, {
  BOOT_VIRTUAL_MODULE_ID,
  CONFIG_ENTRY_VIRTUAL_MODULE_ID,
  CONFIG_VIRTUAL_MODULE_ID,
  CSRF_VIRTUAL_MODULE_ID,
  INSTRUMENTATION_ENTRY_VIRTUAL_MODULE_ID,
  LOG_ENTRY_VIRTUAL_MODULE_ID,
} from './integration';

type ConfigSetup = Extract<AstroIntegration['hooks']['astro:config:setup'], (...args: never[]) => unknown>;

interface ImageUpdate {
  image?: { service?: { entrypoint: string } | undefined; endpoint?: { entrypoint: string } | undefined } | undefined;
}

function createConfig(service: { entrypoint: string; config: Record<string, unknown> }): AstroConfig {
  const root = pathToFileURL('/project/');

  return {
    root,
    srcDir: new URL('src/', root),
    trailingSlash: 'never',
    security: { allowedDomains: [] },
    image: { service, endpoint: {} },
    vite: {},
  } as unknown as AstroConfig;
}

function runSetup(config: AstroConfig): ImageUpdate {
  const updateConfig = vi.fn();
  const setup = node().hooks['astro:config:setup'] as ConfigSetup;

  setup({
    command: 'build',
    config,
    updateConfig,
    addMiddleware: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  } as unknown as Parameters<ConfigSetup>[0]);

  return updateConfig.mock.calls[0]![0] as ImageUpdate;
}

describe('image service', () => {
  test('turns image processing off when the astro config leaves image.service at its default', () => {
    const update = runSetup(createConfig({ entrypoint: 'astro/assets/services/sharp', config: {} }));

    expect(update.image?.service?.entrypoint).toBe('@astroscope/node/image-service');
    expect(update.image?.endpoint?.entrypoint).toBe('@astroscope/node/image-endpoint');
  });

  test('keeps a non-sharp image.service from the astro config', () => {
    const update = runSetup(createConfig({ entrypoint: 'astro/assets/services/noop', config: {} }));

    expect(update.image?.service).toBeUndefined();
    expect(update.image?.endpoint?.entrypoint).toBe('astro/assets/endpoint/node');
  });

  test('treats an explicit sharpImageService() like the default: sharp needs imageService on', () => {
    const update = runSetup(createConfig({ ...sharpImageService(), config: {} }));

    expect(update.image?.service?.entrypoint).toBe('@astroscope/node/image-service');
  });
});

type Hooks = AstroIntegration['hooks'];
type Hook<Name extends keyof Hooks> = Extract<Hooks[Name], (...args: never[]) => unknown>;
type DevHandler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

interface VirtualPlugin {
  configEnvironment(name: string): unknown;
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
}

interface Update {
  trailingSlash?: string | undefined;
  security: { allowedDomains?: unknown[] | undefined; checkOrigin?: boolean | undefined };
  image: { endpoint: { route: string; entrypoint: string } };
  vite: { cacheDir?: string | undefined; plugins: { name: string }[] };
}

interface Setup {
  integration: AstroIntegration;
  update: Update;
  middlewares: string[];
  plugin: VirtualPlugin;
  /** the code the plugin serves for a virtual module id */
  loadVirtual(id: string): string | undefined;
}

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));

  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }

  clearNativeMounts();
  getLogStore().root = undefined;
});

/** a project root on disk holding the given files (relative path → content) */
function createProject(files: Record<string, string> = {}): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'astroscope-integration-')));

  roots.push(root);

  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }

  return root;
}

function createProjectConfig(root: string, overrides: Record<string, unknown> = {}): AstroConfig {
  const rootUrl = pathToFileURL(`${root}/`);

  return {
    root: rootUrl,
    srcDir: new URL('src/', rootUrl),
    trailingSlash: 'ignore',
    security: {},
    image: { service: { entrypoint: 'astro/assets/services/noop', config: {} }, endpoint: {} },
    vite: {},
    server: { host: false, port: 4321 },
    build: { client: new URL('dist/client/', rootUrl), server: new URL('dist/server/', rootUrl) },
    ...overrides,
  } as unknown as AstroConfig;
}

function createLogger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function setup(options: NodeOptions = {}, config = createProjectConfig('/project'), command = 'build'): Setup {
  const integration = node(options);
  const updateConfig = vi.fn();
  const addMiddleware = vi.fn();

  (integration.hooks['astro:config:setup'] as Hook<'astro:config:setup'>)({
    command,
    config,
    updateConfig,
    addMiddleware,
    logger: createLogger(),
  } as unknown as Parameters<Hook<'astro:config:setup'>>[0]);

  const update = updateConfig.mock.calls[0]![0] as Update;
  const plugin = update.vite.plugins.find((candidate) => candidate.name === '@astroscope/node') as unknown as VirtualPlugin;

  return {
    integration,
    update,
    middlewares: addMiddleware.mock.calls.map(([middleware]) => (middleware as { entrypoint: string }).entrypoint),
    plugin,
    loadVirtual: (id) => plugin.load(plugin.resolveId(id)!),
  };
}

function finishConfig(integration: AstroIntegration, config: AstroConfig): void {
  (integration.hooks['astro:config:done'] as Hook<'astro:config:done'>)({
    config,
    setAdapter: vi.fn(),
  } as unknown as Parameters<Hook<'astro:config:done'>>[0]);
}

/** the options object the runtime imports from the config virtual module */
function loadRuntimeOptions(options: NodeOptions, overrides: Record<string, unknown> = {}): RuntimeOptions {
  const config = createProjectConfig('/project', overrides);
  const { integration, loadVirtual } = setup(options, config);

  finishConfig(integration, config);

  const code = loadVirtual(CONFIG_VIRTUAL_MODULE_ID)!;
  const prefix = 'export const options = ';

  expect(code.startsWith(prefix)).toBe(true);

  return vm.runInThisContext(`(${code.slice(prefix.length, -1)})`) as RuntimeOptions;
}

describe('config defaults', () => {
  test('an unset trailingSlash becomes never, an explicit one is kept', () => {
    expect(setup().update.trailingSlash).toBe('never');
    expect(setup({}, createProjectConfig('/project', { trailingSlash: 'always' })).update).not.toHaveProperty('trailingSlash');
  });

  test('every host is allowed unless the project lists its own domains', () => {
    const own = createProjectConfig('/project', { security: { allowedDomains: [{ hostname: 'example.com' }] } });

    expect(setup().update.security.allowedDomains).toEqual([{}]);
    expect(setup({}, own).update.security).not.toHaveProperty('allowedDomains');
  });

  test('astro\'s origin check is switched off only while the csrf middleware replaces it', () => {
    expect(setup().update.security.checkOrigin).toBe(false);
    expect(setup({ csrf: false }).update.security).not.toHaveProperty('checkOrigin');
  });

  test('every command but dev gets a vite cache dir of its own', () => {
    const config = createProjectConfig('/project', { vite: { cacheDir: '.cache/vite' } });

    expect(setup({}, config, 'build').update.vite.cacheDir).toBe(path.resolve('/project/.cache/vite/build'));
    expect(setup({ boot: false }, config, 'dev').update.vite).not.toHaveProperty('cacheDir');
  });

  test('the image endpoint follows imageService and the command, a configured one wins', () => {
    const configured = createProjectConfig('/project', {
      image: { service: { entrypoint: 'astro/assets/services/noop', config: {} }, endpoint: { route: '/img', entrypoint: './src/img.ts' } },
    });
    const sharp = createProjectConfig('/project', {
      image: { service: { entrypoint: 'astro/assets/services/sharp', config: {} }, endpoint: {} },
    });

    expect(setup({ boot: false }, createProjectConfig('/project'), 'dev').update.image.endpoint).toEqual({
      route: '_image',
      entrypoint: 'astro/assets/endpoint/dev',
    });
    expect(setup({}, configured).update.image.endpoint).toEqual({ route: '/img', entrypoint: './src/img.ts' });
    expect(setup({ imageService: 'off' }, configured).update.image.endpoint.entrypoint).toBe('@astroscope/node/image-endpoint');
    expect(setup({ imageService: 'on' }, sharp).update.image.endpoint.entrypoint).toBe('astro/assets/endpoint/node');
  });
});

describe('middleware', () => {
  test('route enrichment runs before csrf, the islands rewriter wraps both', () => {
    expect(setup().middlewares).toEqual([
      '@astroscope/node/route-middleware',
      '@astroscope/node/csrf-middleware',
      '@astroscope/node/islands-middleware',
    ]);
  });

  test('disabled features contribute no middleware', () => {
    expect(setup({ csrf: false }).middlewares).not.toContain('@astroscope/node/csrf-middleware');
    expect(setup({ logging: false }).middlewares).toContain('@astroscope/node/route-middleware');
    expect(setup({ logging: false, telemetry: false, csrf: false }).middlewares).toEqual([
      '@astroscope/node/islands-middleware',
    ]);
  });

  test('the stale-request middleware exists only where the dev server restarts', () => {
    const config = createProjectConfig('/project');
    const stale = '@astroscope/node/dev-middleware';

    expect(setup({}, config, 'dev').middlewares).toContain(stale);
    expect(setup({}, config, 'build').middlewares).not.toContain(stale);
    expect(setup({ boot: { watch: false } }, config, 'dev').middlewares).not.toContain(stale);
    expect(setup({ boot: false }, config, 'dev').middlewares).not.toContain(stale);
  });
});

describe('virtual modules', () => {
  test('the package is bundled into the server environments only', () => {
    const { plugin } = setup();

    for (const environment of ['ssr', 'prerender', 'astro']) {
      expect(plugin.configEnvironment(environment), environment).toEqual({ resolve: { noExternal: ['@astroscope/node'] } });
    }

    expect(plugin.configEnvironment('client')).toBeUndefined();
  });

  test('only the own ids are resolved and loaded', () => {
    const { plugin } = setup();
    const ids = [
      CONFIG_VIRTUAL_MODULE_ID,
      BOOT_VIRTUAL_MODULE_ID,
      CSRF_VIRTUAL_MODULE_ID,
      CONFIG_ENTRY_VIRTUAL_MODULE_ID,
      INSTRUMENTATION_ENTRY_VIRTUAL_MODULE_ID,
      LOG_ENTRY_VIRTUAL_MODULE_ID,
    ];

    expect(ids.map((id) => plugin.resolveId(id))).toEqual(ids.map((id) => `\0${id}`));
    expect(plugin.resolveId('virtual:@astroscope/node/other')).toBeUndefined();
    expect(plugin.resolveId('./src/boot.ts')).toBeUndefined();
    expect(plugin.load('/project/src/boot.ts')).toBeUndefined();
  });

  test('a project without boot or seam files gets empty modules', () => {
    const { loadVirtual } = setup({}, createProjectConfig(createProject()));

    expect(loadVirtual(BOOT_VIRTUAL_MODULE_ID)).toBe('export {};');
    expect(loadVirtual(CONFIG_ENTRY_VIRTUAL_MODULE_ID)).toBe('export {};');
    expect(loadVirtual(INSTRUMENTATION_ENTRY_VIRTUAL_MODULE_ID)).toBe('export {};');
    expect(loadVirtual(LOG_ENTRY_VIRTUAL_MODULE_ID)).toBe('export default undefined;');
  });

  test('the seam files of a project are picked up by convention', () => {
    const root = createProject({
      'src/boot.ts': '',
      'src/config.ts': '',
      'src/instrumentation.ts': '',
      'src/log.ts': '',
    });
    const { loadVirtual } = setup({}, createProjectConfig(root));
    const file = (name: string) => JSON.stringify(path.join(root, 'src', name));

    expect(loadVirtual(BOOT_VIRTUAL_MODULE_ID)).toBe(`export * from ${file('boot.ts')};`);
    expect(loadVirtual(CONFIG_ENTRY_VIRTUAL_MODULE_ID)).toBe(`import ${file('config.ts')};\nexport {};`);
    expect(loadVirtual(INSTRUMENTATION_ENTRY_VIRTUAL_MODULE_ID)).toBe(`export * from ${file('instrumentation.ts')};`);
    expect(loadVirtual(LOG_ENTRY_VIRTUAL_MODULE_ID)).toBe(`export { default } from ${file('log.ts')};`);
  });

  test('src/boot/index.ts wins over src/boot.ts, an explicit entry over both', () => {
    const root = createProject({ 'src/boot.ts': '', 'src/boot/index.ts': '', 'src/startup.ts': '' });
    const config = createProjectConfig(root);

    expect(setup({}, config).loadVirtual(BOOT_VIRTUAL_MODULE_ID)).toContain(
      JSON.stringify(path.join(root, 'src/boot/index.ts')),
    );
    expect(setup({ boot: { entry: 'src/startup.ts' } }, config).loadVirtual(BOOT_VIRTUAL_MODULE_ID)).toContain(
      JSON.stringify(path.join(root, 'src/startup.ts')),
    );
  });

  test('boot: false ignores an existing boot file', () => {
    const root = createProject({ 'src/boot.ts': '' });

    expect(setup({ boot: false }, createProjectConfig(root)).loadVirtual(BOOT_VIRTUAL_MODULE_ID)).toBe('export {};');
  });

  test('a configured boot entry that does not exist fails the setup', () => {
    const config = createProjectConfig(createProject());

    expect(() => setup({ boot: { entry: 'src/missing.ts' } }, config)).toThrow(
      '[@astroscope/node] boot entry not found: src/missing.ts',
    );
  });

  test('csrf exclude patterns survive serialization, regular expressions included', () => {
    const { loadVirtual } = setup({ csrf: { exclude: [{ prefix: '/webhooks/' }, { pattern: /^\/api\/v\d+\// }] } });

    expect(loadVirtual(CSRF_VIRTUAL_MODULE_ID)).toBe(
      String.raw`export const excludePatterns = [{"prefix":"/webhooks/"}, { pattern: /^\/api\/v\d+\// }];`,
    );
    expect(setup({ csrf: false }).loadVirtual(CSRF_VIRTUAL_MODULE_ID)).toBe('export const excludePatterns = [];');
  });
});

describe('runtime options', () => {
  test('cannot be loaded before the astro config is resolved', () => {
    expect(() => setup().loadVirtual(CONFIG_VIRTUAL_MODULE_ID)).toThrow('astro config not resolved yet');
  });

  test('carry the defaults of an unconfigured adapter', () => {
    const options = loadRuntimeOptions({});

    expect(options).toMatchObject({
      host: 'localhost',
      port: 4321,
      client: pathToFileURL('/project/dist/client/').href,
      server: pathToFileURL('/project/dist/server/').href,
      bodySizeLimit: 1024 * 1024,
      shutdownTimeout: 10_000,
      keepAliveTimeout: 120_000,
      health: {},
      redactedQueryParams: [...OTEL_REDACTED_QUERY_PARAMS],
      logging: { exclude: [...RECOMMENDED_EXCLUDES], extended: false },
      telemetry: { exclude: [...RECOMMENDED_EXCLUDES], prometheus: {} },
    });
  });

  test('follow the server.host forms of the astro config', () => {
    expect(loadRuntimeOptions({}, { server: { host: true, port: 8080 } })).toMatchObject({ host: '0.0.0.0', port: 8080 });
    expect(loadRuntimeOptions({}, { server: { host: '10.0.0.5' } })).toMatchObject({ host: '10.0.0.5', port: 4321 });
    expect(loadRuntimeOptions({}, { server: { host: false } }).host).toBe('localhost');
  });

  test('carry the adapter options, regular expressions in excludes included', () => {
    const options = loadRuntimeOptions({
      bodySizeLimit: 0,
      shutdownTimeout: 500,
      keepAliveTimeout: 61_000,
      redactedQueryParams: ['token'],
      health: { host: '127.0.0.1', port: 9091, paths: { live: '/alive' } },
      logging: { exclude: [{ pattern: /^\/internal\// }], extended: true },
      telemetry: { exclude: [{ exact: '/ping' }], prometheus: { port: 9500 } },
    });

    expect(options).toEqual({
      host: 'localhost',
      port: 4321,
      client: pathToFileURL('/project/dist/client/').href,
      server: pathToFileURL('/project/dist/server/').href,
      bodySizeLimit: 0,
      shutdownTimeout: 500,
      keepAliveTimeout: 61_000,
      redactedQueryParams: ['token'],
      health: { host: '127.0.0.1', port: 9091, paths: { live: '/alive' } },
      logging: { exclude: [{ pattern: /^\/internal\// }], extended: true },
      telemetry: { exclude: [{ exact: '/ping' }], prometheus: { port: 9500 } },
    });
  });

  test('disabled features are carried as false', () => {
    expect(loadRuntimeOptions({ health: false, logging: false, telemetry: false })).toMatchObject({
      health: false,
      logging: false,
      telemetry: false,
    });
  });
});

describe('dev request handler', () => {
  /** the connect handler the dev plugin puts in front of astro's own, served on an ephemeral port */
  async function startDevServer(options: NodeOptions, config = createProjectConfig('/project')): Promise<string> {
    const { integration, update } = setup({ boot: false, ...options }, config, 'dev');
    const devPlugin = update.vite.plugins.find((plugin) => plugin.name === '@astroscope/node/dev-request') as unknown as {
      configureServer(server: unknown): () => void;
    };
    const stack: { route: string; handle: DevHandler }[] = [];

    devPlugin.configureServer({ middlewares: { stack } })();
    finishConfig(integration, config);

    const server = createServer((req, res) => {
      stack[0]!.handle(req, res, () => {
        res.end(`astro:${req.url}`);
      });
    });

    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function fetchText(url: string): Promise<string> {
    const response = await fetch(url);

    return response.text();
  }

  async function fetchRequestId(url: string): Promise<string | null> {
    const response = await fetch(url);

    await response.text();

    return response.headers.get('x-request-id');
  }

  test('is installed in dev only', () => {
    const names = (command: string) =>
      setup({ boot: false }, createProjectConfig('/project'), command).update.vite.plugins.map((plugin) => plugin.name);

    expect(names('dev')).toContain('@astroscope/node/dev-request');
    expect(names('build')).not.toContain('@astroscope/node/dev-request');
  });

  test('redirects by the resolved trailingSlash before a native mount or astro sees the request', async () => {
    mountNativeHandler({ prefix: '/oidc' }, (_req, res) => void res.end('mounted'));

    const url = await startDevServer({}, createProjectConfig('/project', { trailingSlash: 'never' }));
    const redirected = await fetch(`${url}/oidc/`, { redirect: 'manual' });

    expect(redirected.status).toBe(301);
    expect(redirected.headers.get('location')).toBe('/oidc');
    expect(await fetchText(`${url}/oidc`)).toBe('mounted');
    expect(await fetchText(`${url}/page`)).toBe('astro:/page');
  });

  // announces a body of the given size without sending it: the limit is decided on the header
  function announceBody(url: string, size: number): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: { 'content-length': size } }, (res) => {
        resolve(res.statusCode);
        req.destroy();
      });

      req.on('error', reject);
      req.flushHeaders();
    });
  }

  test('refuses a body above the limit, the default being 1 MiB', async () => {
    const byDefault = await startDevServer({});

    expect(await announceBody(`${byDefault}/submit`, 1024 * 1024)).toBe(200);
    expect(await announceBody(`${byDefault}/submit`, 1024 * 1024 + 1)).toBe(413);

    const configured = await startDevServer({ bodySizeLimit: 8 });

    expect(await announceBody(`${configured}/submit`, 9)).toBe(413);
  });

  test('instruments requests only when logging or telemetry opt into dev', async () => {
    getLogStore().root = pino({ level: 'silent' });

    const plain = await startDevServer({});
    const logged = await startDevServer({ logging: { dev: true } });

    expect(await fetchRequestId(`${plain}/page`)).toBeNull();
    expect(await fetchRequestId(`${logged}/page`)).toMatch(/^[0-9a-f]{8}$/);
    expect(await fetchRequestId(`${logged}/_astro/chunk.js`)).toBeNull();
  });
});

describe('astro:build:done', () => {
  const ISLAND = '<astro-island component-url="/_astro/Cart.aaa.js" client="load" opts="{}"></astro-island>';
  const PAGE = `<html><body>${ISLAND}${'<p>prerendered content</p>'.repeat(64)}</body></html>`;

  function runBuildDone(integration: AstroIntegration, logger = createLogger()): Promise<void> {
    const done = integration.hooks['astro:build:done'] as Hook<'astro:build:done'>;

    return Promise.resolve(done({ logger } as unknown as Parameters<Hook<'astro:build:done'>>[0]));
  }

  test('rewrites prerendered pages from the islands manifest before compressing them', async () => {
    const root = createProject({
      'dist/client/index.html': PAGE,
      'dist/server/chunks/islands-manifest.json': JSON.stringify({
        runtimeSource: '/* gate runtime */',
        chunks: { '_astro/Cart.aaa.js': { i: ['_astro/shared.bbb.js'] }, '_astro/shared.bbb.js': {} },
      }),
    });
    const config = createProjectConfig(root);
    const { integration } = setup({}, config);
    const logger = createLogger();

    finishConfig(integration, config);

    await runBuildDone(integration, logger);

    const rewritten = fs.readFileSync(path.join(root, 'dist/client/index.html'), 'utf8');
    const compressed = brotliDecompressSync(fs.readFileSync(path.join(root, 'dist/client/index.html.br'))).toString();

    expect(rewritten).toContain('/_astro/shared.bbb.js');
    expect(compressed).toBe(rewritten);
    expect(logger.info).toHaveBeenCalledWith('islands rewrite applied to 1 prerendered page(s)');
  });

  test('compresses the client dir as it is when the build wrote no islands manifest', async () => {
    const root = createProject({ 'dist/client/index.html': PAGE });
    const config = createProjectConfig(root);
    const { integration } = setup({}, config);
    const logger = createLogger();

    finishConfig(integration, config);

    await runBuildDone(integration, logger);

    expect(fs.readFileSync(path.join(root, 'dist/client/index.html'), 'utf8')).toBe(PAGE);
    expect(brotliDecompressSync(fs.readFileSync(path.join(root, 'dist/client/index.html.br'))).toString()).toBe(PAGE);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('1 files compressed'));
  });
});
