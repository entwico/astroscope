import { afterEach, describe, expect, test, vi } from 'vitest';
import { on } from './events';
import { runShutdown, runStartup } from './lifecycle';
import type { BootContext } from './types';

const ctx: BootContext = { dev: false, host: 'localhost', port: 4321 };

const EVENTS_STORE_KEY = Symbol.for('@astroscope/node/boot-events');

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[EVENTS_STORE_KEY];
});

function trackEvents(calls: string[]): void {
  on('beforeOnStartup', () => {
    calls.push('beforeOnStartup');
  });

  on('afterOnStartup', () => {
    calls.push('afterOnStartup');
  });

  on('beforeOnShutdown', () => {
    calls.push('beforeOnShutdown');
  });

  on('afterOnShutdown', () => {
    calls.push('afterOnShutdown');
  });
}

describe('runStartup', () => {
  test('emits lifecycle events around onStartup', async () => {
    const calls: string[] = [];

    trackEvents(calls);

    await runStartup(
      {
        onStartup: (context) => {
          calls.push('onStartup');

          expect(context).toBe(ctx);
        },
      },
      ctx,
    );

    expect(calls).toEqual(['beforeOnStartup', 'onStartup', 'afterOnStartup']);
  });

  test('emits both events when the boot module has no onStartup', async () => {
    const calls: string[] = [];

    trackEvents(calls);

    await runStartup({}, ctx);

    expect(calls).toEqual(['beforeOnStartup', 'afterOnStartup']);
  });

  test('awaits an async onStartup before emitting afterOnStartup', async () => {
    const calls: string[] = [];

    trackEvents(calls);

    await runStartup(
      {
        onStartup: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          calls.push('onStartup');
        },
      },
      ctx,
    );

    expect(calls).toEqual(['beforeOnStartup', 'onStartup', 'afterOnStartup']);
  });

  test('propagates an onStartup error without emitting afterOnStartup', async () => {
    const calls: string[] = [];

    trackEvents(calls);

    await expect(
      runStartup(
        {
          onStartup: () => {
            throw new Error('boom');
          },
        },
        ctx,
      ),
    ).rejects.toThrow('boom');

    expect(calls).toEqual(['beforeOnStartup']);
  });
});

describe('runShutdown', () => {
  test('emits lifecycle events around onShutdown', async () => {
    const calls: string[] = [];

    trackEvents(calls);

    await runShutdown(
      {
        onShutdown: (context) => {
          calls.push('onShutdown');

          expect(context).toBe(ctx);
        },
      },
      ctx,
    );

    expect(calls).toEqual(['beforeOnShutdown', 'onShutdown', 'afterOnShutdown']);
  });

  test('emits afterOnShutdown even when onShutdown throws', async () => {
    const calls: string[] = [];

    trackEvents(calls);

    await expect(
      runShutdown(
        {
          onShutdown: () => {
            throw new Error('shutdown failed');
          },
        },
        ctx,
      ),
    ).rejects.toThrow('shutdown failed');

    expect(calls).toEqual(['beforeOnShutdown', 'afterOnShutdown']);
  });

  test('emits afterOnShutdown even when a beforeOnShutdown handler throws', async () => {
    const calls: string[] = [];
    const onShutdown = vi.fn(() => {});

    on('beforeOnShutdown', () => {
      throw new Error('handler failed');
    });

    on('afterOnShutdown', () => {
      calls.push('afterOnShutdown');
    });

    await expect(runShutdown({ onShutdown }, ctx)).rejects.toThrow('handler failed');

    expect(onShutdown).not.toHaveBeenCalled();
    expect(calls).toEqual(['afterOnShutdown']);
  });
});
