import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const log = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('../observability/log/index.js', () => ({ log }));

const { withShutdownDeadline } = await import('./deadline');

describe('withShutdownDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    log.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('a phase finishing in time passes through silently', async () => {
    await withShutdownDeadline('onShutdown', () => Promise.resolve(), 1000);

    expect(log.error).not.toHaveBeenCalled();
  });

  test('a hanging phase is given up after the deadline with an error', async () => {
    const pending = withShutdownDeadline('onShutdown', () => new Promise(() => {}), 1000);

    await vi.advanceTimersByTimeAsync(1000);
    await pending;

    expect(log.error).toHaveBeenCalledWith({ phase: 'onShutdown', timeoutMs: 1000 }, 'shutdown phase timed out, exiting anyway');
  });

  test('a failing phase rejects as it would alone', async () => {
    await expect(withShutdownDeadline('onShutdown', () => Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});
