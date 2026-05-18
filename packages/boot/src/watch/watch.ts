import type { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HotPayload, ViteDevServer } from 'vite';
import { GEN_HEADER, getCurrentGeneration } from './generation.js';
import { ignoredSuffixes } from './ignored.js';
import type { RestartScheduler } from './scheduler.js';
import { getAstroHotEnv } from './vite-env.js';

const RESTART_HTML = readFileSync(fileURLToPath(new URL('./restart-page.html', import.meta.url)), 'utf8');

export function setupBootWatch(server: ViteDevServer, entry: string, scheduler: RestartScheduler): void {
  const bootFilePath = path.resolve(server.config.root, entry);

  const runnableEnv = getAstroHotEnv(server);
  const bootModuleGraph = runnableEnv?.moduleGraph;

  const collectBootDependencies = (): Set<string> => {
    const deps = new Set<string>();
    const bootModules = bootModuleGraph?.getModulesByFile(bootFilePath);
    const bootModule = bootModules ? [...bootModules][0] : undefined;

    if (!bootModule) return deps;

    const visit = (mod: typeof bootModule, seen = new Set<string>()): void => {
      if (!mod?.file || seen.has(mod.file)) return;

      seen.add(mod.file);
      deps.add(mod.file);

      for (const imp of mod.importedModules) visit(imp, seen);
    };

    visit(bootModule);

    return deps;
  };

  const shouldIgnore = (filePath: string): boolean => {
    const p = filePath.toLowerCase();

    return ignoredSuffixes.some((suffix) => p.endsWith(suffix));
  };

  const onWatcherEvent = (changedPath: string): void => {
    if (shouldIgnore(changedPath)) return;

    const bootDeps = collectBootDependencies();

    if (!bootDeps.has(changedPath)) return;

    scheduler.schedule(server, changedPath);
  };

  server.watcher.on('change', onWatcherEvent);
  server.watcher.on('add', onWatcherEvent);
  server.watcher.on('unlink', onWatcherEvent);

  // ignore full-reloads emitted during server startup (dep optimization, port retries).
  let handleFullReloads = false;

  if (server.httpServer) {
    server.httpServer.once('listening', () => {
      handleFullReloads = true;
    });
  } else {
    // middleware mode — no httpServer, enable immediately
    handleFullReloads = true;
  }

  // SSR full-reloads come through the runnable env's hot channel and clear
  // its module runner's cache — onStartup needs to run again on a fresh server.
  const outsideEmitter = (runnableEnv?.hot as { api?: { outsideEmitter?: EventEmitter } } | undefined)?.api
    ?.outsideEmitter;

  if (outsideEmitter) {
    outsideEmitter.on('send', (payload: HotPayload) => {
      if (!handleFullReloads) return;
      if (payload.type !== 'full-reload') return;

      const triggeredBy = 'triggeredBy' in payload ? (payload.triggeredBy as string) : undefined;

      scheduler.scheduleFullReload(server, triggeredBy);
    });
  }
}

const READINESS_PATH = '/__astroscope_boot_ready';

/**
 * Gate requests: show 503 holding page during restart, readiness probe for the reload.
 */
export function installBootGate(
  server: Pick<ViteDevServer, 'middlewares'>,
  scheduler: Pick<RestartScheduler, 'waitForRestart' | 'isRestartPending' | 'getLastFailure'>,
): void {
  const middlewares = server.middlewares as unknown as {
    stack: { route: string; handle: unknown }[];
  };

  // must be `stack.unshift`ed to land before astro's handler
  middlewares.stack.unshift({
    route: '',
    handle: (async (
      req: { url?: string },
      res: {
        writeHead: (status: number, headers: Record<string, string>) => void;
        end: (body?: string) => void;
        headersSent?: boolean;
      },
      next: (err?: unknown) => void,
    ) => {
      // readiness probe: holding page polls this. blocks until no restart is in
      // flight, then 204 on success / 503 + JSON error if last attempt failed.
      if (req.url === READINESS_PATH) {
        await scheduler.waitForRestart();

        if (res.headersSent) return;

        const failure = scheduler.getLastFailure();

        if (failure) {
          res.writeHead(503, { 'cache-control': 'no-store', 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: failure.message }));

          return;
        }

        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();

        return;
      }

      if (isDevInternalPath(req.url)) {
        next();

        return;
      }

      // respond now; awaiting the restart would let vite destroy the socket mid-response.
      if (scheduler.isRestartPending()) {
        res.writeHead(503, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'retry-after': '1',
        });
        res.end(RESTART_HTML);

        return;
      }

      next();
    }) as never,
  });
}

function isDevInternalPath(url: string | undefined): boolean {
  if (!url) return false;

  return url.startsWith('/@') || url.startsWith('/__') || url.includes('/node_modules/');
}

/**
 * Stamp the current generation onto every incoming request so the runtime
 * Astro middleware can later detect whether the request belongs to a previous
 * (now torn-down) generation
 */
export function installGenStamp(server: Pick<ViteDevServer, 'middlewares'>): void {
  const middlewares = server.middlewares as unknown as {
    stack: { route: string; handle: unknown }[];
  };

  middlewares.stack.unshift({
    route: '',
    handle: ((req: { headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.headers[GEN_HEADER] = String(getCurrentGeneration());
      next();
    }) as never,
  });
}
