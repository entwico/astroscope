import type { IslandEmitter, IslandInfo } from '@astroscope/node/islands';
import type { APIContext } from 'astro';
import { test, vi } from 'vitest';
import type { ExtractionManifest } from '../extraction/types';

const REGISTRY = Symbol.for('@astroscope/node.islandEmitters');
const DOCUMENT_REGISTRY = Symbol.for('@astroscope/node.documentEmitters');

// a site-sized manifest: 60 chunks with a handful of keys each, 10 script entries
const chunkNames = Array.from({ length: 60 }, (_, i) => `Chunk${i}.C${i.toString(16).padStart(3, '0')}`);
const manifest: ExtractionManifest = {
  keys: [],
  chunks: Object.fromEntries(chunkNames.map((name) => [name, Array.from({ length: 6 }, (_, k) => `${name}.key${k}`)])),
  scripts: chunkNames.slice(0, 10),
};

vi.mock('virtual:@astroscope/i18n/manifest', () => ({ getManifest: () => manifest }));

(globalThis as Record<symbol, unknown>)[REGISTRY] = [];
(globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] = [];

const { i18n } = await import('./i18n');
const { registerI18nEmitters, createI18nDocumentEmitter, setRequestLocale } = await import('./islands-emitter');

await i18n.configure({ locales: ['en', 'de'] });
i18n.setTranslations(
  'en',
  Object.fromEntries(Object.values(manifest.chunks).flatMap((keys) => keys.map((key) => [key, `text for ${key}`]))),
);
registerI18nEmitters();

const emitter = ((globalThis as Record<symbol, unknown>)[REGISTRY] as IslandEmitter[])[0]!;
const documentEmitter = createI18nDocumentEmitter(false);

const url = (name: string) => `/_astro/${name}.js`;

// an island whose static closure spans 4 translated chunks plus the renderer, with 2 lazy chunks on top
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

function createContext(): APIContext {
  const context = { request: new Request('http://bench.local/'), locals: {} } as APIContext;

  setRequestLocale(context, 'en');

  return context;
}

test('i18n islands emitter', async ({ bench }) => {
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
    bench('document end script (script-entry hashes)', () => {
      documentEmitter(createContext())?.end?.();
    }),
  );
});
