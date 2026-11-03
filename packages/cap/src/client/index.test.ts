import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('virtual:@astroscope/cap/config', () => ({ path: '/_cap/' }));
vi.mock('@cap.js/wasm/browser/cap_wasm_bg.wasm?url', () => ({ default: '/wasm' }));
vi.mock('@cap.js/wasm/browser/hashwx.wasm?url', () => ({ default: '/hashwx' }));
vi.mock('pako/browser/inflate?url', () => ({ default: '/pako' }));
vi.mock('cap-widget', () => ({}));

const { createCapSession, solveCap } = await import('./index');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

function solver(...results: (string | null)[]) {
  let count = 0;

  return vi.fn(() => Promise.resolve(results.length > 0 ? results.shift()! : `token-${++count}`));
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

  test('ensure resolves null when the solver throws', async () => {
    const solve = vi.fn(() => Promise.reject(new Error('worker crashed')));
    const session = createCapSession(solve);

    expect(await session.ensure()).toBeNull();
    expect(solve).toHaveBeenCalledTimes(1);
  });

  test('a prepare whose solver throws leaves nothing behind for ensure', async () => {
    const solve = vi.fn<() => Promise<string | null>>().mockRejectedValueOnce(new Error('worker crashed'));
    const session = createCapSession(solve);

    session.prepare();

    await vi.waitFor(() => expect(solve).toHaveBeenCalledTimes(1));

    solve.mockResolvedValueOnce('token');

    expect(await session.ensure()).toBe('token');
    expect(solve).toHaveBeenCalledTimes(2);
  });
});

describe('solveCap', () => {
  // the vendor widget's solve() returns undefined while a solve of the same instance is running
  class ReentrancyGuardedCap {
    private _solving = false;
    private _count = 0;

    async solve() {
      if (this._solving) return;

      this._solving = true;
      await Promise.resolve();
      this._solving = false;

      return { success: true, token: `token-${++this._count}` };
    }
  }

  beforeEach(() => {
    vi.stubGlobal('window', { Cap: ReentrancyGuardedCap });
    vi.stubGlobal('document', { addEventListener: vi.fn() });
    vi.stubGlobal('customElements', { whenDefined: () => Promise.resolve() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('concurrent solves each resolve a token', async () => {
    const tokens = await Promise.all([solveCap(), solveCap()]);

    expect(tokens).toEqual([expect.any(String), expect.any(String)]);
    expect(tokens[0]).not.toBe(tokens[1]);
  });
});
