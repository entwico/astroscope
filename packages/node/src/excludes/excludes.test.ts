import type { APIContext } from 'astro';
import { describe, expect, test, vi } from 'vitest';
import {
  ASTRO_STATIC_EXCLUDES,
  DEV_EXCLUDES,
  RECOMMENDED_EXCLUDES,
  STATIC_EXCLUDES,
  shouldExclude,
  withExcluded,
} from './excludes';

function makeContext(url: string): APIContext {
  return { url: new URL(url, 'http://localhost') } as APIContext;
}

describe('shouldExclude', () => {
  test('returns false when exclude is undefined', () => {
    expect(shouldExclude(makeContext('/page'), undefined)).toBe(false);
  });

  test('returns false for an empty pattern array', () => {
    expect(shouldExclude(makeContext('/page'), [])).toBe(false);
  });

  test('matches prefix patterns', () => {
    const exclude = [{ prefix: '/api/' }];

    expect(shouldExclude(makeContext('/api/users'), exclude)).toBe(true);
    expect(shouldExclude(makeContext('/apiary'), exclude)).toBe(false);
  });

  test('matches exact patterns', () => {
    const exclude = [{ exact: '/health' }];

    expect(shouldExclude(makeContext('/health'), exclude)).toBe(true);
    expect(shouldExclude(makeContext('/health/live'), exclude)).toBe(false);
  });

  test('matches suffix, includes and regex patterns', () => {
    expect(shouldExclude(makeContext('/assets/logo.svg'), [{ suffix: '.svg' }])).toBe(true);
    expect(shouldExclude(makeContext('/some/internal/path'), [{ includes: 'internal' }])).toBe(true);
    expect(shouldExclude(makeContext('/api/v2/users'), [{ pattern: /^\/api\/v\d+\// }])).toBe(true);
    expect(shouldExclude(makeContext('/page'), [{ suffix: '.svg' }, { includes: 'internal' }])).toBe(false);
  });

  test('matches against the pathname only, ignoring the query string', () => {
    expect(shouldExclude(makeContext('/health?probe=live'), [{ exact: '/health' }])).toBe(true);
    expect(shouldExclude(makeContext('/page?section=api'), [{ includes: 'api' }])).toBe(false);
  });

  test('delegates to a function exclude with the full context', () => {
    const ctx = makeContext('/admin');
    const exclude = vi.fn((context: APIContext) => context.url.pathname === '/admin');

    expect(shouldExclude(ctx, exclude)).toBe(true);
    expect(exclude).toHaveBeenCalledWith(ctx);
    expect(shouldExclude(makeContext('/page'), exclude)).toBe(false);
  });
});

describe('withExcluded', () => {
  test('runs the middleware for non-excluded paths', async () => {
    const response = new Response('from middleware');
    const middleware = vi.fn(() => Promise.resolve(response));
    const next = vi.fn(() => Promise.resolve(new Response('from next')));

    const wrapped = withExcluded(middleware, [{ prefix: '/skip/' }]);
    const ctx = makeContext('/page');

    await expect(wrapped(ctx, next)).resolves.toBe(response);
    expect(middleware).toHaveBeenCalledWith(ctx, next);
    expect(next).not.toHaveBeenCalled();
  });

  test('skips the middleware and calls next for excluded paths', async () => {
    const response = new Response('from next');
    const middleware = vi.fn(() => Promise.resolve(new Response('from middleware')));
    const next = vi.fn(() => Promise.resolve(response));

    const wrapped = withExcluded(middleware, [{ prefix: '/skip/' }]);

    await expect(wrapped(makeContext('/skip/this'), next)).resolves.toBe(response);
    expect(middleware).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  test('supports a function exclude', async () => {
    const middleware = vi.fn(() => Promise.resolve(new Response('from middleware')));
    const next = vi.fn(() => Promise.resolve(new Response('from next')));

    const wrapped = withExcluded(middleware, () => true);

    await wrapped(makeContext('/anything'), next);

    expect(middleware).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('pattern sets', () => {
  test('RECOMMENDED_EXCLUDES combines dev and astro static excludes', () => {
    expect(RECOMMENDED_EXCLUDES).toEqual([...DEV_EXCLUDES, ...ASTRO_STATIC_EXCLUDES]);
  });

  test('DEV_EXCLUDES matches vite dev server paths', () => {
    for (const pathname of [
      '/@id/some-module',
      '/@fs/Users/x/file.ts',
      '/@vite/client',
      '/src/pages/index.astro',
      '/node_modules/react/index.js',
    ]) {
      expect(shouldExclude(makeContext(pathname), DEV_EXCLUDES)).toBe(true);
    }
  });

  test('ASTRO_STATIC_EXCLUDES matches astro internals', () => {
    expect(shouldExclude(makeContext('/_astro/index.abc123.css'), ASTRO_STATIC_EXCLUDES)).toBe(true);
    expect(shouldExclude(makeContext('/_image?href=%2Flogo.png'), ASTRO_STATIC_EXCLUDES)).toBe(true);
  });

  test('STATIC_EXCLUDES matches well-known assets at the root only', () => {
    expect(shouldExclude(makeContext('/favicon.ico'), STATIC_EXCLUDES)).toBe(true);
    expect(shouldExclude(makeContext('/robots.txt'), STATIC_EXCLUDES)).toBe(true);
    expect(shouldExclude(makeContext('/blog/robots.txt'), STATIC_EXCLUDES)).toBe(false);
  });

  test('none of the sets match regular pages', () => {
    for (const set of [DEV_EXCLUDES, ASTRO_STATIC_EXCLUDES, STATIC_EXCLUDES, RECOMMENDED_EXCLUDES]) {
      expect(shouldExclude(makeContext('/'), set)).toBe(false);
      expect(shouldExclude(makeContext('/products/42'), set)).toBe(false);
    }
  });
});
