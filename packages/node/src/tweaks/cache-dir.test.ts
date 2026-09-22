import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveCommandCacheDir } from './cache-dir';

const root = path.resolve('/project');

describe('resolveCommandCacheDir', () => {
  test('leaves the dev server on the default cache dir', () => {
    expect(resolveCommandCacheDir(root, 'dev', undefined)).toBeUndefined();
  });

  test('gives sync and build cache dirs of their own under the default', () => {
    expect(resolveCommandCacheDir(root, 'sync', undefined)).toBe(path.join(root, 'node_modules/.vite/sync'));
    expect(resolveCommandCacheDir(root, 'build', undefined)).toBe(path.join(root, 'node_modules/.vite/build'));
  });

  test('nests under a configured cache dir, relative or absolute', () => {
    expect(resolveCommandCacheDir(root, 'sync', '.cache/vite')).toBe(path.join(root, '.cache/vite/sync'));
    expect(resolveCommandCacheDir(root, 'build', '/tmp/vite-cache')).toBe(path.resolve('/tmp/vite-cache/build'));
  });
});
