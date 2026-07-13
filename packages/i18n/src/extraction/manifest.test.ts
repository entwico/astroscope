import { afterEach, describe, expect, test } from 'vitest';
import { getGlobalState, getManifest } from './manifest';

const GLOBAL_KEY = '__astroscope_i18n_manifest__';

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
});

describe('getGlobalState', () => {
  test('initializes empty state on first access', () => {
    const state = getGlobalState();

    expect(state).toEqual({
      extractedKeys: [],
      chunkManifest: {},
      importsManifest: {},
      projectRoot: '',
      version: 0,
    });
  });

  test('returns the same state object on repeated calls', () => {
    const first = getGlobalState();
    const second = getGlobalState();

    expect(second).toBe(first);
  });

  test('stores state on globalThis so mutations survive re-imports', () => {
    const state = getGlobalState();

    state.version = 5;

    expect((globalThis as Record<string, unknown>)[GLOBAL_KEY]).toBe(state);
    expect(getGlobalState().version).toBe(5);
  });
});

describe('getManifest', () => {
  test('returns empty manifest for fresh state', () => {
    expect(getManifest()).toEqual({ keys: [], chunks: {}, imports: {} });
  });

  test('makes file locations relative to project root and keeps line numbers', () => {
    const state = getGlobalState();

    state.projectRoot = '/project';
    state.extractedKeys = [
      {
        key: 'cart.title',
        meta: { fallback: 'Shopping Cart' },
        files: ['/project/src/pages/cart.astro:12', '/project/src/components/Cart.tsx:5'],
      },
    ];

    const manifest = getManifest();

    expect(manifest.keys[0]?.files).toEqual(['src/pages/cart.astro:12', 'src/components/Cart.tsx:5']);
  });

  test('keeps file paths as-is when project root is empty', () => {
    const state = getGlobalState();

    state.extractedKeys = [{ key: 'a', meta: { fallback: 'A' }, files: ['/somewhere/src/a.ts:3'] }];

    expect(getManifest().keys[0]?.files).toEqual(['/somewhere/src/a.ts:3']);
  });

  test('handles locations without a line number', () => {
    const state = getGlobalState();

    state.projectRoot = '/project';
    state.extractedKeys = [{ key: 'a', meta: { fallback: 'A' }, files: ['/project/src/a.ts'] }];

    expect(getManifest().keys[0]?.files).toEqual(['src/a.ts']);
  });

  test('keeps paths containing colons intact', () => {
    const state = getGlobalState();

    state.extractedKeys = [{ key: 'a', meta: { fallback: 'A' }, files: ['C:\\project\\src\\a.ts:12'] }];

    expect(getManifest().keys[0]?.files).toEqual(['C:\\project\\src\\a.ts:12']);
  });

  test('does not mutate the stored keys', () => {
    const state = getGlobalState();

    state.projectRoot = '/project';
    state.extractedKeys = [{ key: 'a', meta: { fallback: 'A' }, files: ['/project/src/a.ts:1'] }];

    getManifest();

    expect(state.extractedKeys[0]?.files).toEqual(['/project/src/a.ts:1']);
  });

  test('passes chunk and imports manifests through', () => {
    const state = getGlobalState();

    state.chunkManifest = { 'Cart.abc': ['cart.title'] };
    state.importsManifest = { 'Page.def': ['Cart.abc'] };

    const manifest = getManifest();

    expect(manifest.chunks).toEqual({ 'Cart.abc': ['cart.title'] });
    expect(manifest.imports).toEqual({ 'Page.def': ['Cart.abc'] });
  });
});
