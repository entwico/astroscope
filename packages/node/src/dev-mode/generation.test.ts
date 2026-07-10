import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getCurrentGeneration, incrementGeneration, recordStaleError } from './generation';

const STATE_KEY = Symbol.for('@astroscope/node/generation');

beforeEach(() => {
  // reset the globalThis-backed state so each test starts fresh
  (globalThis as Record<symbol, unknown>)[STATE_KEY] = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('generation counter', () => {
  test('starts at 0', () => {
    expect(getCurrentGeneration()).toBe(0);
  });

  test('increments by 1 on each call', () => {
    incrementGeneration();
    incrementGeneration();
    incrementGeneration();

    expect(getCurrentGeneration()).toBe(3);
  });
});

describe('recordStaleError', () => {
  test('flushes a single aggregated log line per burst', async () => {
    vi.useFakeTimers();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    recordStaleError();
    recordStaleError();
    recordStaleError();

    expect(log).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toBe(
      '[@astroscope/node] suppressed 3 stale request errors from a previous app generation',
    );
  });

  test('uses singular phrasing for a single error', async () => {
    vi.useFakeTimers();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    recordStaleError();

    await vi.advanceTimersByTimeAsync(60);

    expect(log.mock.calls[0]![0]).toBe(
      '[@astroscope/node] suppressed 1 stale request error from a previous app generation',
    );
  });

  test('a later burst starts a fresh count after the flush', async () => {
    vi.useFakeTimers();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    recordStaleError();
    recordStaleError();
    await vi.advanceTimersByTimeAsync(60);

    recordStaleError();
    await vi.advanceTimersByTimeAsync(60);

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toContain('suppressed 2 stale request errors');
    expect(log.mock.calls[1]![0]).toContain('suppressed 1 stale request error');
  });
});
