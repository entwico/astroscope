import { afterEach, describe, expect, test, vi } from 'vitest';
import { emit, off, on } from './events';
import type { BootContext } from './types';

const ctx: BootContext = { dev: false, host: 'localhost', port: 4321 };

// clean up global store between tests
const STORE_KEY = Symbol.for('@astroscope/boot/events');

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
});

describe('on / off / emit', () => {
  test('registered handler fires on emit', async () => {
    const handler = vi.fn(() => {});

    on('afterOnStartup', handler);

    await emit('afterOnStartup', ctx);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(ctx);
  });

  test('handler only fires for its registered event', async () => {
    const handler = vi.fn(() => {});

    on('afterOnStartup', handler);

    await emit('beforeOnStartup', ctx);

    expect(handler).toHaveBeenCalledTimes(0);
  });

  test('off removes a handler', async () => {
    const handler = vi.fn(() => {});

    on('afterOnStartup', handler);
    off('afterOnStartup', handler);

    await emit('afterOnStartup', ctx);

    expect(handler).toHaveBeenCalledTimes(0);
  });

  test('multiple handlers fire in registration order', async () => {
    const order: number[] = [];

    on('beforeOnShutdown', () => {
      order.push(1);
    });

    on('beforeOnShutdown', () => {
      order.push(2);
    });

    on('beforeOnShutdown', () => {
      order.push(3);
    });

    await emit('beforeOnShutdown', ctx);

    expect(order).toEqual([1, 2, 3]);
  });

  test('async handlers are awaited sequentially', async () => {
    const order: number[] = [];

    on('afterOnStartup', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(1);
    });

    on('afterOnStartup', async () => {
      order.push(2);
    });

    await emit('afterOnStartup', ctx);

    expect(order).toEqual([1, 2]);
  });

  test('emit with no registered handlers is a no-op', async () => {
    await emit('beforeOnStartup', ctx);
  });

  test('off on non-existent handler is a no-op', () => {
    off('afterOnShutdown', () => {});
  });

  test('same handler can be registered for different events', async () => {
    const handler = vi.fn(() => {});

    on('beforeOnStartup', handler);
    on('afterOnStartup', handler);

    await emit('beforeOnStartup', ctx);
    await emit('afterOnStartup', ctx);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
