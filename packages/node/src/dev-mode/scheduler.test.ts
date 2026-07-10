import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RestartScheduler } from './scheduler';

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createMockServer(opts?: { root?: string }) {
  return {
    config: { root: opts?.root ?? '/project' },
    restart: vi.fn(async () => {}),
  };
}

const logger = { info: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('RestartScheduler', () => {
  describe('debounce', () => {
    test('coalesces a burst into a single restart', async () => {
      vi.useFakeTimers();

      const server = createMockServer();
      const scheduler = new RestartScheduler(100, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');
      scheduler.schedule(server as never, '/project/src/b.ts');
      scheduler.schedule(server as never, '/project/src/c.ts');

      await vi.advanceTimersByTimeAsync(50);
      expect(server.restart).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60);

      expect(server.restart).toHaveBeenCalledTimes(1);
    });

    test('logs the aggregated paths once per burst, relative to project root', async () => {
      vi.useFakeTimers();

      const server = createMockServer({ root: '/project' });
      const scheduler = new RestartScheduler(100, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');
      scheduler.schedule(server as never, '/project/src/b.ts');
      scheduler.schedule(server as never, '/project/src/c.ts');

      // no log yet — debouncing
      expect(logger.info).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(110);

      expect(logger.info).toHaveBeenCalledTimes(1);

      const msg = logger.info.mock.calls[0]![0] as string;

      expect(msg).toContain('boot deps changed (3)');
      expect(msg).toContain('src/a.ts');
      expect(msg).toContain('src/b.ts');
      expect(msg).toContain('src/c.ts');
    });

    test('uses singular form when only one path changed', async () => {
      vi.useFakeTimers();

      const server = createMockServer({ root: '/project' });
      const scheduler = new RestartScheduler(100, logger);

      scheduler.schedule(server as never, '/project/src/services.ts');

      await vi.advanceTimersByTimeAsync(110);

      const msg = logger.info.mock.calls[0]![0] as string;

      expect(msg).toMatch(/^boot dep changed: src\/services\.ts/);
    });

    test('a later event after the timer fired starts a new burst with its own log', async () => {
      vi.useFakeTimers();

      const server = createMockServer({ root: '/project' });
      const scheduler = new RestartScheduler(100, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');
      await vi.advanceTimersByTimeAsync(110);
      await vi.runAllTimersAsync();

      expect(server.restart).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledTimes(1);

      scheduler.schedule(server as never, '/project/src/b.ts');
      await vi.advanceTimersByTimeAsync(110);

      expect(server.restart).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledTimes(2);
      expect(logger.info.mock.calls[1]![0]).toContain('src/b.ts');
    });
  });

  describe('chaining when a restart is in flight', () => {
    test('events arriving during one restart trigger a follow-up with its own log line', async () => {
      const server = createMockServer({ root: '/project' });
      const first = createDeferred();
      const second = createDeferred();

      server.restart
        .mockImplementationOnce(async () => {
          await first.promise;
        })
        .mockImplementationOnce(async () => {
          await second.promise;
        });

      const scheduler = new RestartScheduler(0, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');

      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(1));

      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info.mock.calls[0]![0]).toContain('src/a.ts');

      // event arrives during the in-flight restart
      scheduler.schedule(server as never, '/project/src/b.ts');

      // debouncer fires but should queue, not start another restart
      await new Promise((r) => setTimeout(r, 10));

      expect(server.restart).toHaveBeenCalledTimes(1);
      // log fires when the actual restart starts, not when queued
      expect(logger.info).toHaveBeenCalledTimes(1);

      first.resolve();

      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(2));

      expect(logger.info).toHaveBeenCalledTimes(2);
      expect(logger.info.mock.calls[1]![0]).toContain('src/b.ts');
      expect(logger.info.mock.calls[1]![0]).not.toContain('src/a.ts');

      second.resolve();
    });

    test('multiple events during one restart aggregate into a single follow-up log', async () => {
      const server = createMockServer({ root: '/project' });
      const first = createDeferred();
      const second = createDeferred();

      server.restart
        .mockImplementationOnce(async () => {
          await first.promise;
        })
        .mockImplementationOnce(async () => {
          await second.promise;
        });

      const scheduler = new RestartScheduler(0, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');

      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(1));

      scheduler.schedule(server as never, '/project/src/b.ts');
      scheduler.schedule(server as never, '/project/src/c.ts');
      scheduler.schedule(server as never, '/project/src/d.ts');

      await new Promise((r) => setTimeout(r, 10));

      first.resolve();

      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(2));

      expect(logger.info).toHaveBeenCalledTimes(2);

      const followUp = logger.info.mock.calls[1]![0] as string;

      expect(followUp).toContain('src/b.ts');
      expect(followUp).toContain('src/c.ts');
      expect(followUp).toContain('src/d.ts');
      expect(followUp).not.toContain('src/a.ts');

      // assert exactly two restarts — not three
      await new Promise((r) => setTimeout(r, 10));
      expect(server.restart).toHaveBeenCalledTimes(2);

      second.resolve();
    });

    test('chains a deep sequence of restarts — each link logs only its own paths and the chain terminates when events stop', async () => {
      const server = createMockServer({ root: '/project' });
      // each restart call captures a deferred we can release on demand to advance the chain
      const restartGates: Array<{ resolve: () => void }> = [];

      server.restart.mockImplementation(async () => {
        const gate = createDeferred();

        restartGates.push(gate);

        await gate.promise;
      });

      const scheduler = new RestartScheduler(0, logger);

      // chain link 1 — drains paths {a}
      scheduler.schedule(server as never, '/project/src/a.ts');
      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(1));

      // event during link 1 — queues link 2
      scheduler.schedule(server as never, '/project/src/b.ts');
      // give the debouncer a moment to fire and mark the chain as pending
      await new Promise((r) => setTimeout(r, 10));

      // release link 1 → link 2 starts (drains paths {b})
      restartGates[0]!.resolve();
      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(2));

      // event during link 2 — queues link 3
      scheduler.schedule(server as never, '/project/src/c.ts');
      await new Promise((r) => setTimeout(r, 10));

      // release link 2 → link 3 starts (drains paths {c})
      restartGates[1]!.resolve();
      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(3));

      // no events queued for link 4 — chain should terminate after link 3 resolves
      restartGates[2]!.resolve();

      // give the loop time to spin one more iteration if it were going to (it shouldn't)
      await new Promise((r) => setTimeout(r, 30));

      expect(server.restart).toHaveBeenCalledTimes(3);

      // each link's log carries ONLY its own paths
      expect(logger.info).toHaveBeenCalledTimes(3);
      expect(logger.info.mock.calls[0]![0]).toContain('src/a.ts');
      expect(logger.info.mock.calls[0]![0]).not.toContain('src/b.ts');
      expect(logger.info.mock.calls[1]![0]).toContain('src/b.ts');
      expect(logger.info.mock.calls[1]![0]).not.toContain('src/a.ts');
      expect(logger.info.mock.calls[1]![0]).not.toContain('src/c.ts');
      expect(logger.info.mock.calls[2]![0]).toContain('src/c.ts');
      expect(logger.info.mock.calls[2]![0]).not.toContain('src/b.ts');

      // and a brand-new schedule after the chain ended starts a fresh chain (not a 4th link)
      scheduler.schedule(server as never, '/project/src/d.ts');
      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(4));
      restartGates[3]!.resolve();
    });

    test('chained links each aggregate their own burst — paths from earlier links never leak forward', async () => {
      const server = createMockServer({ root: '/project' });
      const restartGates: Array<{ resolve: () => void }> = [];

      server.restart.mockImplementation(async () => {
        const gate = createDeferred();

        restartGates.push(gate);

        await gate.promise;
      });

      const scheduler = new RestartScheduler(0, logger);

      // link 1 — burst of 2 paths
      scheduler.schedule(server as never, '/project/src/a1.ts');
      scheduler.schedule(server as never, '/project/src/a2.ts');
      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(1));

      // burst of 3 paths during link 1 — should aggregate into link 2
      scheduler.schedule(server as never, '/project/src/b1.ts');
      scheduler.schedule(server as never, '/project/src/b2.ts');
      scheduler.schedule(server as never, '/project/src/b3.ts');
      await new Promise((r) => setTimeout(r, 10));

      restartGates[0]!.resolve();
      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(2));

      // single path during link 2 — should be the only one in link 3
      scheduler.schedule(server as never, '/project/src/c1.ts');
      await new Promise((r) => setTimeout(r, 10));

      restartGates[1]!.resolve();
      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(3));

      restartGates[2]!.resolve();
      await new Promise((r) => setTimeout(r, 20));

      expect(server.restart).toHaveBeenCalledTimes(3);
      expect(logger.info).toHaveBeenCalledTimes(3);

      // link 1: a1, a2 only
      const link1 = logger.info.mock.calls[0]![0] as string;

      expect(link1).toContain('boot deps changed (2)');
      expect(link1).toContain('src/a1.ts');
      expect(link1).toContain('src/a2.ts');
      expect(link1).not.toMatch(/b\d|c\d/);

      // link 2: b1, b2, b3 only
      const link2 = logger.info.mock.calls[1]![0] as string;

      expect(link2).toContain('boot deps changed (3)');
      expect(link2).toContain('src/b1.ts');
      expect(link2).toContain('src/b2.ts');
      expect(link2).toContain('src/b3.ts');
      expect(link2).not.toMatch(/a\d|c\d/);

      // link 3: c1 only — singular form
      const link3 = logger.info.mock.calls[2]![0] as string;

      expect(link3).toMatch(/^boot dep changed: src\/c1\.ts/);
      expect(link3).not.toMatch(/a\d|b\d/);
    });

    test('logs and continues when server.restart() rejects', async () => {
      const server = createMockServer();

      server.restart.mockRejectedValueOnce(new Error('boom'));

      const scheduler = new RestartScheduler(0, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');

      await vi.waitFor(() => expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('restart')));

      // a subsequent schedule should still trigger another restart (state is reset)
      scheduler.schedule(server as never, '/project/src/b.ts');

      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(2));
    });
  });

  describe('cross-instance survival', () => {
    test('the same scheduler instance can be used across multiple watcher cycles', async () => {
      const server = createMockServer();
      const scheduler = new RestartScheduler(0, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');
      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(1));

      // simulate post-restart state — same scheduler, possibly a new server reference
      const server2 = createMockServer();

      scheduler.schedule(server2 as never, '/project/src/b.ts');
      await vi.waitFor(() => expect(server2.restart).toHaveBeenCalledTimes(1));
    });
  });

  describe('scheduleFullReload', () => {
    test('triggers a restart and logs the SSR full-reload reason', async () => {
      vi.useFakeTimers();

      const server = createMockServer({ root: '/project' });
      const scheduler = new RestartScheduler(100, logger);

      scheduler.scheduleFullReload(server as never, '/project/src/components/HeaderClient.tsx');

      await vi.advanceTimersByTimeAsync(110);

      expect(server.restart).toHaveBeenCalledTimes(1);

      const msg = logger.info.mock.calls[0]![0] as string;

      expect(msg).toContain('vite SSR full-reload');
      expect(msg).toContain('src/components/HeaderClient.tsx');
    });

    test('falls back to a generic message when no triggeredBy is provided', async () => {
      vi.useFakeTimers();

      const server = createMockServer({ root: '/project' });
      const scheduler = new RestartScheduler(100, logger);

      scheduler.scheduleFullReload(server as never);

      await vi.advanceTimersByTimeAsync(110);

      const msg = logger.info.mock.calls[0]![0] as string;

      expect(msg).toMatch(/^vite SSR full-reload — restarting dev server/);
    });

    test('combines a boot-dep change and a full-reload in the same debounce window into one log line', async () => {
      vi.useFakeTimers();

      const server = createMockServer({ root: '/project' });
      const scheduler = new RestartScheduler(100, logger);

      scheduler.schedule(server as never, '/project/src/services.ts');
      scheduler.scheduleFullReload(server as never, '/project/src/components/A.tsx');

      await vi.advanceTimersByTimeAsync(110);

      expect(server.restart).toHaveBeenCalledTimes(1);

      const msg = logger.info.mock.calls[0]![0] as string;

      expect(msg).toContain('boot dep changed: src/services.ts');
      expect(msg).toContain('vite SSR full-reload');
      expect(msg).toContain('src/components/A.tsx');
      expect(msg).toContain('+');
    });

    test('multiple full-reloads in the same window list all triggeredBy paths', async () => {
      vi.useFakeTimers();

      const server = createMockServer({ root: '/project' });
      const scheduler = new RestartScheduler(100, logger);

      scheduler.scheduleFullReload(server as never, '/project/src/A.tsx');
      scheduler.scheduleFullReload(server as never, '/project/src/B.tsx');
      scheduler.scheduleFullReload(server as never, '/project/src/A.tsx'); // duplicate

      await vi.advanceTimersByTimeAsync(110);

      const msg = logger.info.mock.calls[0]![0] as string;

      expect(msg).toContain('vite SSR full-reload');
      expect(msg).toContain('src/A.tsx');
      expect(msg).toContain('src/B.tsx');
    });

    test('a full-reload arriving during an in-flight restart triggers a follow-up', async () => {
      const server = createMockServer({ root: '/project' });
      const first = createDeferred();
      const second = createDeferred();

      server.restart
        .mockImplementationOnce(async () => {
          await first.promise;
        })
        .mockImplementationOnce(async () => {
          await second.promise;
        });

      const scheduler = new RestartScheduler(0, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');
      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(1));

      scheduler.scheduleFullReload(server as never, '/project/src/b.tsx');
      await new Promise((r) => setTimeout(r, 10));

      // first restart still pending — follow-up queued, not yet running
      expect(server.restart).toHaveBeenCalledTimes(1);

      first.resolve();
      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(2));

      // follow-up log mentions the full-reload, not the boot dep
      expect(logger.info.mock.calls[1]![0]).toContain('vite SSR full-reload');
      expect(logger.info.mock.calls[1]![0]).not.toContain('src/a.ts');

      second.resolve();
    });
  });

  describe('waitForRestart', () => {
    test('resolves immediately when no restart is in flight', async () => {
      const scheduler = new RestartScheduler(0, logger);

      let resolved = false;

      void scheduler.waitForRestart().then(() => {
        resolved = true;
      });

      // give the microtask queue a chance to drain
      await new Promise((r) => setTimeout(r, 0));

      expect(resolved).toBe(true);
    });

    test('blocks while a restart is running and resolves after it completes', async () => {
      const server = createMockServer();
      const gate = createDeferred();

      server.restart.mockImplementationOnce(async () => {
        await gate.promise;
      });

      const scheduler = new RestartScheduler(0, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');

      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(1));

      let released = false;

      void scheduler.waitForRestart().then(() => {
        released = true;
      });

      // restart still in flight — request must NOT have been released
      await new Promise((r) => setTimeout(r, 20));
      expect(released).toBe(false);

      gate.resolve();

      await vi.waitFor(() => expect(released).toBe(true));
    });

    test('resolves (does not reject) when the restart fails', async () => {
      const server = createMockServer();

      server.restart.mockRejectedValueOnce(new Error('boom'));

      const scheduler = new RestartScheduler(0, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');

      await vi.waitFor(() => expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('restart')));

      // gate should already be released — failure releases the gate
      let released = false;

      void scheduler.waitForRestart().then(() => {
        released = true;
      });

      await vi.waitFor(() => expect(released).toBe(true));
    });

    test('spans the entire chain — does not release between iterations', async () => {
      const server = createMockServer();
      const first = createDeferred();
      const second = createDeferred();

      server.restart
        .mockImplementationOnce(async () => {
          await first.promise;
        })
        .mockImplementationOnce(async () => {
          await second.promise;
        });

      const scheduler = new RestartScheduler(0, logger);

      scheduler.schedule(server as never, '/project/src/a.ts');

      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(1));

      // queue a chained restart by scheduling during the first
      scheduler.schedule(server as never, '/project/src/b.ts');

      // give the debounce setTimeout time to fire and mark the chain as pending
      await new Promise((r) => setTimeout(r, 10));

      let released = false;

      void scheduler.waitForRestart().then(() => {
        released = true;
      });

      // release first restart — chain should kick off the second, gate stays closed
      first.resolve();

      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(2));
      await new Promise((r) => setTimeout(r, 20));

      expect(released).toBe(false);

      second.resolve();

      await vi.waitFor(() => expect(released).toBe(true));
    });
  });
});
