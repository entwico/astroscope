import { beforeEach, describe, expect, test } from 'vitest';
import { getRouteIslands, installRouteIslands } from './routes';
import type { IslandsManifest } from './types';

const manifest: IslandsManifest = {
  runtimeSource: '',
  chunks: {
    '_astro/Cart.a.js': { i: ['_astro/react.b.js'], d: ['_astro/Modal.c.js'] },
    '_astro/Modal.c.js': { i: ['_astro/react.b.js'] },
    '_astro/react.b.js': {},
  },
  routes: { '/': ['_astro/Cart.a.js'], '/about': [] },
};

describe('getRouteIslands', () => {
  beforeEach(() => {
    installRouteIslands(null);
  });

  test('null without a manifest', () => {
    expect(getRouteIslands('/')).toBeNull();
  });

  test('resolves closures per island of a known route, same objects on repeat', () => {
    installRouteIslands(manifest);

    const islands = getRouteIslands('/');

    expect(islands).toEqual([
      {
        fileName: '_astro/Cart.a.js',
        staticClosure: ['_astro/Cart.a.js', '_astro/react.b.js'],
        fullClosure: ['_astro/Cart.a.js', '_astro/react.b.js', '_astro/Modal.c.js'],
      },
    ]);
    expect(getRouteIslands('/')).toBe(islands);
  });

  test('a route without islands is an empty list, an unknown route is null', () => {
    installRouteIslands(manifest);

    expect(getRouteIslands('/about')).toEqual([]);
    expect(getRouteIslands('/unknown')).toBeNull();
  });
});
