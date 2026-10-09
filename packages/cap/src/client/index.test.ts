import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('virtual:@astroscope/cap/config', () => ({ path: '/_cap/' }));
vi.mock('@cap.js/wasm/browser/cap_wasm_bg.wasm?url', () => ({ default: '/wasm' }));
vi.mock('@cap.js/wasm/browser/hashwx.wasm?url', () => ({ default: '/hashwx' }));
vi.mock('pako/dist/pako_inflate.min.js?url', () => ({ default: '/pako' }));

const { createCapSession } = await import('./index');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

function solver(...results: (string | null)[]) {
  let count = 0;

  return vi.fn(async () => (results.length ? results.shift()! : `token-${++count}`));
}

describe('createCapSession', () => {
  test('ensure solves when nothing was prepared', async () => {
    const solve = solver();
    const session = createCapSession(solve);

    expect(await session.ensure()).toBe('token-1');
    expect(solve).toHaveBeenCalledTimes(1);
  });

  test('ensure hands out a prepared token once, then solves anew', async () => {
    const solve = solver();
    const session = createCapSession(solve);

    session.prepare();

    expect(await session.ensure()).toBe('token-1');
    expect(solve).toHaveBeenCalledTimes(1);

    expect(await session.ensure()).toBe('token-2');
    expect(solve).toHaveBeenCalledTimes(2);
  });

  test('prepare does not start a second solve while one is running or a token is prepared', async () => {
    const solve = solver();
    const session = createCapSession(solve);

    session.prepare();
    session.prepare();

    await vi.waitFor(() => expect(solve).toHaveBeenCalledTimes(1));

    session.prepare();

    expect(solve).toHaveBeenCalledTimes(1);
  });

  test('ensure waits for a running prepare instead of solving twice', async () => {
    let resolve!: (value: string) => void;
    const solve = vi.fn(() => new Promise<string | null>((r) => (resolve = r)));
    const session = createCapSession(solve);

    session.prepare();

    const ensured = session.ensure();

    resolve('token');

    expect(await ensured).toBe('token');
    expect(solve).toHaveBeenCalledTimes(1);
  });

  test('a token prepared too long ago is replaced', async () => {
    const solve = solver();
    const session = createCapSession(solve);

    session.prepare();
    await vi.waitFor(() => expect(solve).toHaveBeenCalledTimes(1));

    vi.setSystemTime(1_000_000 + 6 * 60_000);

    expect(await session.ensure()).toBe('token-2');
    expect(solve).toHaveBeenCalledTimes(2);
  });

  test('ensure resolves null when solving fails, and retries next time', async () => {
    const solve = solver(null, null);
    const session = createCapSession(solve);

    expect(await session.ensure()).toBeNull();
    expect(solve).toHaveBeenCalledTimes(1);

    expect(await session.ensure()).toBeNull();
    expect(solve).toHaveBeenCalledTimes(2);
  });
});
