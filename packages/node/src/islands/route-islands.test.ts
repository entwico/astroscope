import type { IntegrationResolvedRoute } from 'astro';
import type { Rolldown } from 'vite';
import { describe, expect, test } from 'vitest';
import { type ModuleGraph, collectRouteIslands, routeEntrypoints, stripQuery } from './route-islands';

type Module = {
  imports?: string[];
  dynamicImports?: string[];
  hydrated?: string[];
  clientOnly?: string[];
};

function createGraph(modules: Record<string, Module>): ModuleGraph {
  return {
    getModuleIds: () => Object.keys(modules)[Symbol.iterator](),
    getModuleInfo: (id) => {
      const module = modules[id];

      if (!module) {
        return null;
      }

      return {
        id,
        importedIds: module.imports ?? [],
        dynamicallyImportedIds: module.dynamicImports ?? [],
        meta: {
          astro: {
            hydratedComponents: (module.hydrated ?? []).map((path) => ({
              exportName: 'default',
              specifier: path,
              resolvedPath: path,
            })),
            clientOnlyComponents: (module.clientOnly ?? []).map((specifier) => ({ exportName: 'default', specifier })),
          },
        },
      } as unknown as Rolldown.ModuleInfo;
    },
    resolve: async (source) => (source.startsWith('/') ? { id: source } : { id: `/resolved${source.slice(1)}` }),
  };
}

describe('collectRouteIslands', () => {
  test('attributes islands of a page and its imported components to the page routes', async () => {
    const graph = createGraph({
      '/src/pages/index.astro': { imports: ['/src/layouts/Layout.astro'], hydrated: ['/src/components/Hero.tsx'] },
      '/src/layouts/Layout.astro': { imports: ['/src/components/Nav.astro'] },
      '/src/components/Nav.astro': { hydrated: ['/src/components/Menu.tsx'] },
      '/src/pages/about.astro': { imports: ['/src/layouts/Layout.astro'] },
    });

    const { routes } = await collectRouteIslands(
      graph,
      new Map([
        ['/src/pages/index.astro', ['/']],
        ['/src/pages/about.astro', ['/about']],
      ]),
    );

    expect([...routes.get('/')!]).toEqual(['/src/components/Hero.tsx', '/src/components/Menu.tsx']);
    expect([...routes.get('/about')!]).toEqual(['/src/components/Menu.tsx']);
  });

  test('follows dynamic imports and resolves client:only specifiers', async () => {
    const graph = createGraph({
      '/src/pages/index.astro': { dynamicImports: ['/src/components/Lazy.astro'] },
      '/src/components/Lazy.astro': { clientOnly: ['./Chart.tsx'] },
    });

    const { routes } = await collectRouteIslands(graph, new Map([['/src/pages/index.astro', ['/']]]));

    expect([...routes.get('/')!]).toEqual(['/resolved/Chart.tsx']);
  });

  test('one page component serves several routes; pages outside the graph stay unknown', async () => {
    const graph = createGraph({
      '/src/pages/[...slug].astro': { hydrated: ['/src/components/Hero.tsx'] },
    });

    const { routes } = await collectRouteIslands(
      graph,
      new Map([
        ['/src/pages/[...slug].astro', ['/[...slug]', '/']],
        ['/src/pages/missing.astro', ['/missing']],
      ]),
    );

    expect(routes.get('/[...slug]')).toEqual(routes.get('/'));
    expect(routes.has('/missing')).toBe(false);
  });

  test('records every route reaching a module', async () => {
    const graph = createGraph({
      '/src/pages/index.astro': { imports: ['/src/lib/cart.ts'] },
      '/src/pages/cart.astro': { imports: ['/src/lib/cart.ts'] },
      '/src/pages/about.astro': {},
      '/src/lib/cart.ts': {},
    });

    const { patternsByModule } = await collectRouteIslands(
      graph,
      new Map([
        ['/src/pages/index.astro', ['/']],
        ['/src/pages/cart.astro', ['/cart']],
        ['/src/pages/about.astro', ['/about']],
      ]),
    );

    expect([...patternsByModule.get('/src/lib/cart.ts')!]).toEqual(['/', '/cart']);
    expect([...patternsByModule.get('/src/pages/about.astro')!]).toEqual(['/about']);
  });

  test('cycles terminate', async () => {
    const graph = createGraph({
      '/src/pages/index.astro': { imports: ['/src/a.astro'] },
      '/src/a.astro': { imports: ['/src/b.astro'] },
      '/src/b.astro': { imports: ['/src/a.astro'], hydrated: ['/src/Island.tsx'] },
    });

    const { routes } = await collectRouteIslands(graph, new Map([['/src/pages/index.astro', ['/']]]));

    expect([...routes.get('/')!]).toEqual(['/src/Island.tsx']);
  });
  test("the walk stops at astro's application manifest, which imports every page", async () => {
    const graph = createGraph({
      '\0virtual:astro:actions/entrypoint': { imports: ['/src/actions/index.ts'] },
      '/src/actions/index.ts': { imports: ['/astro/actions/runtime/server.js'] },
      '/astro/actions/runtime/server.js': { imports: ['\0virtual:astro:manifest'] },
      '\0virtual:astro:manifest': { dynamicImports: ['/src/pages/index.astro', '/src/pages/about.astro'] },
      '/src/pages/index.astro': { hydrated: ['/src/components/Hero.tsx'] },
      '/src/pages/about.astro': { hydrated: ['/src/components/Team.tsx'] },
    });

    const { routes, patternsByModule } = await collectRouteIslands(
      graph,
      new Map([
        ['\0virtual:astro:actions/entrypoint', ['/_actions/[...path]']],
        ['/src/pages/index.astro', ['/']],
      ]),
    );

    expect([...routes.get('/_actions/[...path]')!]).toEqual([]);
    expect([...routes.get('/')!]).toEqual(['/src/components/Hero.tsx']);
    expect(patternsByModule.has('\0virtual:astro:manifest')).toBe(false);
    expect([...patternsByModule.get('/src/pages/index.astro')!]).toEqual(['/']);
  });
});

describe('routeEntrypoints', () => {
  const route = (pattern: string, entrypoint: string, type = 'page'): IntegrationResolvedRoute =>
    ({ pattern, entrypoint, type }) as IntegrationResolvedRoute;

  test('maps pages and endpoints to absolute ids, redirects skipped, actions to the virtual entrypoint', () => {
    const entrypoints = routeEntrypoints('/app', [
      route('/', 'src/pages/index.astro'),
      route('/api', 'src/pages/api.ts', 'endpoint'),
      route('/old', 'src/pages/old.astro', 'redirect'),
      route('/_image', '/abs/image-endpoint.js', 'endpoint'),
      route('/_actions/[...path]', '/abs/astro/actions/route.js', 'endpoint'),
      route('/[...slug]', 'src/pages/index.astro'),
    ]);

    expect([...entrypoints]).toEqual([
      ['/app/src/pages/index.astro', ['/', '/[...slug]']],
      ['/app/src/pages/api.ts', ['/api']],
      ['/abs/image-endpoint.js', ['/_image']],
      ['\0virtual:astro:actions/entrypoint', ['/_actions/[...path]']],
    ]);
  });
});

describe('stripQuery', () => {
  test('drops vite queries, keeps plain ids', () => {
    expect(stripQuery('/src/a.astro?astro&type=script&index=0&lang.ts')).toBe('/src/a.astro');
    expect(stripQuery('/src/a.tsx')).toBe('/src/a.tsx');
  });
});
