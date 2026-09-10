import type { IslandEmitter, IslandInfo } from '@astroscope/node/islands';
import type { APIContext } from 'astro';
import { test, vi } from 'vitest';
import type { WormholeManifest } from './extraction/types';

const REGISTRY = Symbol.for('@astroscope/node.islandEmitters');
const DOCUMENT_REGISTRY = Symbol.for('@astroscope/node.documentEmitters');

// a site-sized manifest: 60 chunks, most reading one or two of 8 wormholes
const chunkNames = Array.from({ length: 60 }, (_, i) => `Chunk${i}.C${i.toString(16).padStart(3, '0')}`);
const wormholeNames = ['session', 'cart', 'flags', 'locale', 'theme', 'consent', 'menu', 'search'];
const manifest: WormholeManifest = {
  chunks: Object.fromEntries(chunkNames.map((name, i) => [name, [wormholeNames[i % 8]!, wormholeNames[(i * 3) % 8]!]])),
  scripts: ['session', 'consent'],
  routes: {},
};

vi.mock('virtual:@astroscope/wormhole/manifest', () => ({ manifest }));

(globalThis as Record<symbol, unknown>)[REGISTRY] = [];
(globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] = [];

const { registerWormholeEmitters, createWormholeDocumentEmitter } = await import('./islands-emitter');
const { setRequestWormholes } = await import('./request-store');

registerWormholeEmitters();

const emitter = ((globalThis as Record<symbol, unknown>)[REGISTRY] as IslandEmitter[])[0]!;
const documentEmitter = createWormholeDocumentEmitter(false);

const url = (name: string) => `/_astro/${name}.js`;

// an island whose closure spans 4 chunks plus the renderer, with 2 lazy chunks on top
function island(index: number): IslandInfo {
  const base = (index * 7) % 50;
  const staticClosure = [
    url(chunkNames[base]!),
    '/_astro/client.Cxyz.js',
    ...chunkNames.slice(base + 1, base + 4).map(url),
  ];

  return {
    componentUrl: staticClosure[0]!,
    rendererUrl: '/_astro/client.Cxyz.js',
    client: 'load',
    staticClosure,
    fullClosure: [...staticClosure, ...chunkNames.slice(base + 4, base + 6).map(url)],
  };
}

const islands = Array.from({ length: 20 }, (_, i) => island(i));

// realistic per-request values: a session object, a cart with a few lines, small flags
const values = {
  session: { id: 'u-1234', name: 'Jane Doe', roles: ['customer'], email: 'jane@example.com' },
  cart: {
    total: 129.9,
    currency: 'EUR',
    lines: Array.from({ length: 4 }, (_, i) => ({ sku: `SKU-${i}`, qty: 1 + i })),
  },
  flags: { newCheckout: true, beta: false },
  locale: 'de',
  theme: 'light',
  consent: { analytics: true, marketing: false },
  menu: { open: false },
  search: { query: '' },
};

function createContext(): APIContext {
  const context = { request: new Request('http://bench.local/') } as APIContext;

  setRequestWormholes(context.request, { values: new Map(Object.entries(values)), emitted: new Set() });

  return context;
}

test('wormhole islands emitter', async ({ bench }) => {
  await bench.compare(
    bench('one island, fresh document', () => {
      emitter(islands[0]!, createContext());
    }),
    bench('twenty islands, one document', () => {
      const context = createContext();

      for (const isle of islands) {
        emitter(isle, context);
      }
    }),
    bench('document end script (script-entry values)', () => {
      documentEmitter(createContext())?.end?.();
    }),
  );
});
