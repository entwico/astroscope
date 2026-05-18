import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IntegrationResolvedRoute } from 'astro';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  ASTRO_MIDDLEWARE_VIRTUAL,
  collectRouteEntrypoints,
  collectWarmupSpecifiers,
  generateWarmupCode,
} from './warmup';

type RouteShape = Pick<IntegrationResolvedRoute, 'type' | 'isPrerendered' | 'entrypoint'>;

function route(overrides: Partial<RouteShape> & Pick<RouteShape, 'entrypoint'>): RouteShape {
  return {
    type: 'page',
    isPrerendered: false,
    ...overrides,
  };
}

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'astroscope-boot-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function touch(rel: string): string {
  const abs = path.join(projectRoot, rel);

  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, '');

  return abs;
}

describe('collectRouteEntrypoints', () => {
  test('returns absolute paths for non-prerendered route entrypoints', () => {
    const indexAbs = touch('src/pages/index.astro');
    const aboutAbs = touch('src/pages/about.astro');

    const result = collectRouteEntrypoints(
      [route({ entrypoint: 'src/pages/index.astro' }), route({ entrypoint: 'src/pages/about.astro' })],
      projectRoot,
    );

    expect(result.sort()).toEqual([aboutAbs, indexAbs].sort());
  });

  test('skips prerendered routes', () => {
    const indexAbs = touch('src/pages/index.astro');
    const apiAbs = touch('src/pages/api.ts');
    touch('src/pages/static.astro');

    const result = collectRouteEntrypoints(
      [
        route({ entrypoint: 'src/pages/index.astro' }),
        route({ entrypoint: 'src/pages/static.astro', isPrerendered: true }),
        route({ entrypoint: 'src/pages/api.ts' }),
      ],
      projectRoot,
    );

    expect(result.sort()).toEqual([apiAbs, indexAbs].sort());
  });

  test('skips redirect and fallback routes', () => {
    const indexAbs = touch('src/pages/index.astro');
    touch('src/pages/old.astro');
    touch('src/pages/missing.astro');

    const result = collectRouteEntrypoints(
      [
        route({ entrypoint: 'src/pages/index.astro' }),
        route({ entrypoint: 'src/pages/old.astro', type: 'redirect' }),
        route({ entrypoint: 'src/pages/missing.astro', type: 'fallback' }),
      ],
      projectRoot,
    );

    expect(result).toEqual([indexAbs]);
  });

  test('skips synthetic entrypoints (no real file on disk)', () => {
    const indexAbs = touch('src/pages/index.astro');

    const result = collectRouteEntrypoints(
      [
        route({ entrypoint: '_server-islands.astro' }),
        route({ entrypoint: 'astro-default-404.astro' }),
        route({ entrypoint: 'src/pages/index.astro' }),
      ],
      projectRoot,
    );

    expect(result).toEqual([indexAbs]);
  });

  test('deduplicates entrypoints (i18n routes share components)', () => {
    const indexAbs = touch('src/pages/index.astro');

    const result = collectRouteEntrypoints(
      [route({ entrypoint: 'src/pages/index.astro' }), route({ entrypoint: 'src/pages/index.astro' })],
      projectRoot,
    );

    expect(result).toEqual([indexAbs]);
  });

  test('skips routes with empty entrypoint', () => {
    const indexAbs = touch('src/pages/index.astro');

    const result = collectRouteEntrypoints(
      [route({ entrypoint: '' }), route({ entrypoint: 'src/pages/index.astro' })],
      projectRoot,
    );

    expect(result).toEqual([indexAbs]);
  });

  test('returns empty array for empty input', () => {
    expect(collectRouteEntrypoints([], projectRoot)).toEqual([]);
  });

  test('resolves entrypoints that point above the project root (e.g. node_modules in pnpm workspace)', () => {
    const parent = path.dirname(projectRoot);

    mkdirSync(path.join(parent, 'shared-pkg'), { recursive: true });
    writeFileSync(path.join(parent, 'shared-pkg', 'endpoint.js'), '');

    const result = collectRouteEntrypoints([route({ entrypoint: '../shared-pkg/endpoint.js' })], projectRoot);

    expect(result).toEqual([path.resolve(parent, 'shared-pkg/endpoint.js')]);

    rmSync(path.join(parent, 'shared-pkg'), { recursive: true, force: true });
  });
});

describe('collectWarmupSpecifiers', () => {
  test('returns absolute route entrypoints followed by the middleware virtual module', () => {
    const indexAbs = touch('src/pages/index.astro');
    const apiAbs = touch('src/pages/api.ts');

    const result = collectWarmupSpecifiers(
      [route({ entrypoint: 'src/pages/index.astro' }), route({ entrypoint: 'src/pages/api.ts' })],
      projectRoot,
    );

    expect(result.slice(0, -1).sort()).toEqual([apiAbs, indexAbs].sort());
    expect(result.at(-1)).toBe(ASTRO_MIDDLEWARE_VIRTUAL);
  });

  test('returns just the middleware virtual module when there are no routes', () => {
    expect(collectWarmupSpecifiers([], projectRoot)).toEqual([ASTRO_MIDDLEWARE_VIRTUAL]);
  });

  test('returns just the middleware virtual module when all routes are prerendered', () => {
    touch('src/pages/static-1.astro');
    touch('src/pages/static-2.astro');

    const result = collectWarmupSpecifiers(
      [
        route({ entrypoint: 'src/pages/static-1.astro', isPrerendered: true }),
        route({ entrypoint: 'src/pages/static-2.astro', isPrerendered: true }),
      ],
      projectRoot,
    );

    expect(result).toEqual([ASTRO_MIDDLEWARE_VIRTUAL]);
  });

  test('middleware is always last', () => {
    touch('src/pages/a.astro');
    touch('src/pages/z.astro');

    const result = collectWarmupSpecifiers(
      [route({ entrypoint: 'src/pages/a.astro' }), route({ entrypoint: 'src/pages/z.astro' })],
      projectRoot,
    );

    expect(result.at(-1)).toBe(ASTRO_MIDDLEWARE_VIRTUAL);
  });
});

describe('generateWarmupCode', () => {
  test('returns empty string for empty list', () => {
    expect(generateWarmupCode([])).toBe('');
  });

  test('emits one import() per specifier', () => {
    const code = generateWarmupCode(['/abs/a.ts', '/abs/b.ts']);

    expect(code).toContain(`import("/abs/a.ts")`);
    expect(code).toContain(`import("/abs/b.ts")`);
  });

  test('wraps imports in Promise.allSettled', () => {
    const code = generateWarmupCode(['/abs/a.ts']);

    expect(code).toContain('Promise.allSettled');
  });

  test('logs rejections via console.error so failures are visible', () => {
    const code = generateWarmupCode(['/abs/a.ts']);

    expect(code).toContain(`'rejected'`);
    expect(code).toContain('console.error');
    expect(code).toContain('warmup import failed');
  });

  test('JSON-encodes specifiers (handles paths with quotes/backslashes)', () => {
    const code = generateWarmupCode([`/abs/with"quote.ts`, `/abs/with\\backslash.ts`]);

    expect(code).toContain(`import("/abs/with\\"quote.ts")`);
    expect(code).toContain(`import("/abs/with\\\\backslash.ts")`);
  });

  test('emits valid JS — parses without throwing', () => {
    const code = generateWarmupCode(['/nonexistent/a.ts', '/nonexistent/b.ts']);
    const wrapped = `async () => {\n${code}\n}`;

    expect(() => new Function(wrapped)).not.toThrow();
  });
});
