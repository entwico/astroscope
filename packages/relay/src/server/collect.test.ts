import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { collect } from './collect.js';
import { relayConsent, runWithRelayContext } from './context.js';

describe('server collect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const inRequest = (consent: Record<string, boolean>, fn: () => void) =>
    runWithRelayContext({ consent, context: {} as APIContext }, fn);

  test('sightings from different requests never share a batch, each flushing in its own request', () => {
    const batches: { items: string[]; consent: unknown }[] = [];
    const see = collect<string, string>({
      flush: (_list, items) => {
        batches.push({ items, consent: relayConsent() });
      },
      within: 100,
    });

    inRequest({ a: true }, () => see('list', 'consenting'));
    inRequest({}, () => see('list', 'declining'));
    vi.runAllTimers();

    expect(batches).toEqual([
      { items: ['consenting'], consent: { a: true } },
      { items: ['declining'], consent: {} },
    ]);
  });

  test('folds the sightings of one request into one batch', () => {
    const flush = vi.fn();
    const see = collect<string, number>({ flush, within: 100 });

    inRequest({ a: true }, () => {
      see('list', 1);
      see('list', 2);
    });
    vi.runAllTimers();

    expect(flush.mock.calls).toEqual([['list', [1, 2]]]);
  });

  test('shares one buffer outside a request', () => {
    const flush = vi.fn();
    const see = collect<string, number>({ flush, within: 100 });

    see('list', 1);
    see('list', 2);
    vi.runAllTimers();

    expect(flush.mock.calls).toEqual([['list', [1, 2]]]);
  });
});
