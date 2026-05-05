import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { serializeError } from './utils.js';

type Logger = { info(msg: string): void; error(msg: string): void };

const FULL_RELOAD_UNKNOWN = '<unknown>';

/**
 * Coordinates dev-server restarts: debounces bursts, chains a follow-up if
 * changes arrive mid-restart (vite's `ssrImport` reads disk at import time,
 * so changes during a restart would otherwise be missed), and logs once per
 * restart with what triggered it.
 *
 * One instance per integration, shared across restart-induced configureServer
 * reruns — chain coordination would be lost if recreated each time.
 */
export class RestartScheduler {
  private _inFlight = false;
  private _pending = false;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _pendingBootDeps = new Set<string>();
  private _pendingFullReloads = new Set<string>();
  // set while a restart chain is running. the gate probes it (`isRestartPending`)
  // to short-circuit requests, and awaits it (`waitForRestart`) on readiness.
  private _runPromise: Promise<void> | undefined;
  // set when a restart attempt fails
  private _lastFailure: { message: string } | undefined;

  constructor(
    private readonly debounceMs: number,
    private readonly logger: Logger,
    private readonly restartDelayMs: number = 0,
  ) {}

  // true from the moment a change is queued until the restart completes — covers
  // the debounce window too, so requests don't slip past the gate before _run starts.
  isRestartPending(): boolean {
    return !!this._runPromise || !!this._debounceTimer || !!this._lastFailure;
  }

  getLastFailure(): { message: string } | undefined {
    return this._lastFailure;
  }

  recordFailure(message: string): void {
    this._lastFailure = { message };
  }

  clearFailure(): void {
    this._lastFailure = undefined;
  }

  schedule(server: ViteDevServer, changedPath: string): void {
    this._pendingBootDeps.add(changedPath);
    this._scheduleRun(server);
  }

  scheduleFullReload(server: ViteDevServer, triggeredBy?: string): void {
    this._pendingFullReloads.add(triggeredBy ?? FULL_RELOAD_UNKNOWN);
    this._scheduleRun(server);
  }

  /**
   * Resolves when no restart is running. Loops to handle back-to-back restarts
   * (e.g. one chain ends and a queued debounce timer immediately fires a new
   * one). Never rejects, so a failed restart still releases the gate — caller
   * proceeds against the broken state rather than hanging forever.
   */
  async waitForRestart(): Promise<void> {
    while (this._runPromise) {
      try {
        await this._runPromise;
      } catch {
        // restart failed — release anyway
      }
    }
  }

  private _scheduleRun(server: ViteDevServer): void {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined;
      void this._run(server);
    }, this.debounceMs);
  }

  private async _run(server: ViteDevServer): Promise<void> {
    if (this._inFlight) {
      // loop driving the in-flight restart will pick up the next iteration.
      this._pending = true;

      return;
    }

    this._inFlight = true;

    let resolveRun!: () => void;

    this._runPromise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });

    try {
      do {
        this._pending = false;

        const bootDeps = [...this._pendingBootDeps].sort();
        const fullReloads = [...this._pendingFullReloads].sort();

        this._pendingBootDeps.clear();
        this._pendingFullReloads.clear();

        if (bootDeps.length > 0 || fullReloads.length > 0) {
          this.logger.info(this._formatReason(server, bootDeps, fullReloads));
        }

        if (this.restartDelayMs > 0) {
          // reduces error logs
          // await new Promise<void>((resolve) => setTimeout(resolve, this.restartDelayMs));
          // resolve();
        }

        try {
          await server.restart();
        } catch (error) {
          this.logger.error(`error during dev server restart: ${serializeError(error)}`);
        }
      } while (this._pending);
    } finally {
      this._inFlight = false;
      this._runPromise = undefined;
      resolveRun();
    }
  }

  private _formatReason(server: ViteDevServer, bootDeps: string[], fullReloads: string[]): string {
    const root = server.config.root;
    const rel = (p: string): string => path.relative(root, p) || p;
    const parts: string[] = [];

    if (bootDeps.length === 1) {
      parts.push(`boot dep changed: ${rel(bootDeps[0]!)}`);
    } else if (bootDeps.length > 1) {
      parts.push(`boot deps changed (${bootDeps.length}): ${bootDeps.map(rel).join(', ')}`);
    }

    if (fullReloads.length > 0) {
      const named = fullReloads.filter((p) => p !== FULL_RELOAD_UNKNOWN);

      if (named.length === 0) {
        parts.push('vite SSR full-reload');
      } else {
        parts.push(`vite SSR full-reload (triggered by ${named.map(rel).join(', ')})`);
      }
    }

    return `${parts.join(' + ')} — restarting dev server`;
  }
}
