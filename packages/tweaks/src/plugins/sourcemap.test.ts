import { describe, expect, test } from 'vitest';
import { ssrSourcemapPlugin } from './sourcemap';

describe('ssrSourcemapPlugin', () => {
  test('enables sourcemap when isSsrBuild is true', () => {
    const plugin = ssrSourcemapPlugin();
    const config = plugin.config as (
      c: unknown,
      env: { isSsrBuild?: boolean },
    ) => { build?: { sourcemap?: boolean } } | undefined;

    const out = config({}, { isSsrBuild: true });

    expect(out).toEqual({ build: { sourcemap: true } });
  });

  test('returns no override when isSsrBuild is false', () => {
    const plugin = ssrSourcemapPlugin();
    const config = plugin.config as (
      c: unknown,
      env: { isSsrBuild?: boolean },
    ) => { build?: { sourcemap?: boolean } } | undefined;

    const out = config({}, { isSsrBuild: false });

    expect(out).toEqual({});
  });

  test('returns no override when isSsrBuild is undefined', () => {
    const plugin = ssrSourcemapPlugin();
    const config = plugin.config as (
      c: unknown,
      env: { isSsrBuild?: boolean },
    ) => { build?: { sourcemap?: boolean } } | undefined;

    const out = config({}, {});

    expect(out).toEqual({});
  });
});
