import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { collect } from './collect.js';

describe('collect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('folds the sightings of one key into a batch after the quiet time', () => {
    const flush = vi.fn();
    const see = collect<string, number>({ flush, within: 100 });

    see('list', 1);
    vi.advanceTimersByTime(80);
    see('list', 2);
    vi.advanceTimersByTime(80);

    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('list', [1, 2]);
  });

  test('keeps a buffer per key', () => {
    const flush = vi.fn();
    const see = collect<string, number>({ flush, within: 100 });

    see('a', 1);
    see('b', 2);
    see('a', 3);
    vi.runAllTimers();

    expect(flush.mock.calls).toEqual([
      ['b', [2]],
      ['a', [1, 3]],
    ]);
  });

  test('splits a full buffer into batches of at most max items', () => {
    const flush = vi.fn();
    const see = collect<string, number>({ flush, within: 100, max: 2 });

    for (const item of [1, 2, 3, 4, 5]) {
      see('list', item);
    }

    vi.runAllTimers();

    expect(flush.mock.calls).toEqual([
      ['list', [1, 2]],
      ['list', [3, 4]],
      ['list', [5]],
    ]);
  });

  test('a max below 1 is taken as 1', () => {
    const flush = vi.fn();
    const see = collect<string, number>({ flush, within: 100, max: 0 });

    see('list', 1);
    see('list', 2);
    vi.runAllTimers();

    expect(flush.mock.calls).toEqual([
      ['list', [1]],
      ['list', [2]],
    ]);
  });

  test('takes an object context through its key, handing back the first one of the batch', () => {
    const flush = vi.fn();
    const see = collect<{ list: string; currency: string }, number>({
      key: ({ list }) => list,
      flush,
      within: 100,
    });

    see({ list: 'search', currency: 'EUR' }, 1);
    see({ list: 'search', currency: 'CHF' }, 2);
    vi.runAllTimers();

    expect(flush).toHaveBeenCalledWith({ list: 'search', currency: 'EUR' }, [1, 2]);
  });

  test('starts a fresh batch after a flush', () => {
    const flush = vi.fn();
    const see = collect<string, number>({ flush, within: 100 });

    see('list', 1);
    vi.runAllTimers();
    see('list', 2);
    vi.runAllTimers();

    expect(flush.mock.calls).toEqual([
      ['list', [1]],
      ['list', [2]],
    ]);
  });
});
