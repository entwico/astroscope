import type { ViteDevServer } from 'vite';
import { describe, expect, test, vi } from 'vitest';
import { getAstroHotEnv, ssrImport } from './vite-env';

// build a fake DevEnvironment as a plain object — instanceof RunnableDevEnvironment
// would return false, which is exactly the case we want to tolerate
function makeRunnableEnv(imported: unknown = { ok: true }) {
  return {
    runner: { import: vi.fn(async () => imported) },
    hot: { send: vi.fn() },
  };
}

function makeNonRunnableEnv() {
  // no `runner` — mirrors Astro 6's design for the `ssr` env
  return { hot: { send: vi.fn() } };
}

function makeServer(environments: Record<string, unknown>): ViteDevServer {
  return { environments } as unknown as ViteDevServer;
}

describe('ssrImport', () => {
  test('uses ssr env when it is runnable', async () => {
    const ssr = makeRunnableEnv({ fromSsr: true });
    const astro = makeRunnableEnv({ fromAstro: true });
    const server = makeServer({ ssr, astro });

    const result = await ssrImport(server, '/boot.ts');

    expect(result).toEqual({ fromSsr: true });
    expect(ssr.runner.import).toHaveBeenCalledWith('/boot.ts');
    expect(astro.runner.import).not.toHaveBeenCalled();
  });

  test('falls back to astro env when ssr is not runnable (astro 6)', async () => {
    const ssr = makeNonRunnableEnv();
    const astro = makeRunnableEnv({ fromAstro: true });
    const server = makeServer({ ssr, astro });

    const result = await ssrImport(server, '/boot.ts');

    expect(result).toEqual({ fromAstro: true });
    expect(astro.runner.import).toHaveBeenCalledWith('/boot.ts');
  });

  test('works with plain objects from a different vite install (duck typing)', async () => {
    // simulates consumer bringing its own vite copy: env is a valid runnable
    // shape but would fail `instanceof RunnableDevEnvironment` against our vite
    const ssr = {
      runner: { import: async (id: string) => ({ importedId: id }) },
      hot: { send: vi.fn() },
    };
    const server = makeServer({ ssr });

    const result = await ssrImport(server, '/x.ts');

    expect(result).toEqual({ importedId: '/x.ts' });
  });

  test('throws listing available envs when none are runnable', async () => {
    const server = makeServer({ ssr: makeNonRunnableEnv(), client: makeNonRunnableEnv() });

    await expect(ssrImport(server, '/boot.ts')).rejects.toThrow(
      /no runnable dev environment found — available: ssr, client/,
    );
  });

  test('rejects env where runner.import is not a function', async () => {
    const ssr = { runner: { import: 'not-a-function' }, hot: { send: vi.fn() } };
    const server = makeServer({ ssr });

    await expect(ssrImport(server, '/boot.ts')).rejects.toThrow(/no runnable dev environment found/);
  });

  test('rejects env where runner is missing', async () => {
    const server = makeServer({ ssr: { hot: { send: vi.fn() } } });

    await expect(ssrImport(server, '/boot.ts')).rejects.toThrow(/no runnable dev environment found/);
  });
});

describe('getAstroHotEnv', () => {
  test('returns ssr when runnable', () => {
    const ssr = makeRunnableEnv();
    const astro = makeRunnableEnv();
    const server = makeServer({ ssr, astro });

    expect(getAstroHotEnv(server)).toBe(ssr);
  });

  test('falls back to astro when ssr is not runnable', () => {
    const ssr = makeNonRunnableEnv();
    const astro = makeRunnableEnv();
    const server = makeServer({ ssr, astro });

    expect(getAstroHotEnv(server)).toBe(astro);
  });

  test('returns undefined when neither is runnable (does not throw)', () => {
    const server = makeServer({ ssr: makeNonRunnableEnv() });

    expect(getAstroHotEnv(server)).toBeUndefined();
  });

  test('returned env exposes a usable hot.send channel', () => {
    const ssr = makeRunnableEnv();
    const server = makeServer({ ssr });

    getAstroHotEnv(server)?.hot.send('astro:middleware-updated', {});

    expect(ssr.hot.send).toHaveBeenCalledWith('astro:middleware-updated', {});
  });
});
