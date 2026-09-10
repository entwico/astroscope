import { test } from 'vitest';
import { createIslandsTransformer } from './transform';
import type { IslandsManifest } from './types';

const REGISTRY = Symbol.for('@astroscope/node.islandEmitters');

(globalThis as Record<symbol, unknown>)[REGISTRY] = [];

const manifest: IslandsManifest = {
  runtimeSource: '/* gate runtime */',
  chunks: {
    '_astro/Cart.aaa.js': { i: ['_astro/shared.bbb.js', '_astro/react.fff.js'], d: ['_astro/Lazy.ddd.js'] },
    '_astro/shared.bbb.js': { i: ['_astro/react.fff.js'] },
    '_astro/react.fff.js': {},
    '_astro/client.ccc.js': { i: ['_astro/react.fff.js'] },
    '_astro/Lazy.ddd.js': {},
  },
};

// astro serializes props as an escaped json attribute; real islands carry kilobytes of it
const PROPS = `{${Array.from({ length: 40 }, (_, i) => `&quot;key${i}&quot;:[0,&quot;value ${i} &amp; more&quot;]`).join(',')}}`;

function island(client: string, props = '{}'): string {
  return `<astro-island uid="x${client}" component-url="/_astro/Cart.aaa.js" renderer-url="/_astro/client.ccc.js" client="${client}" opts="{&quot;name&quot;:&quot;Cart&quot;}" props="${props}"><div class="cart">cart</div></astro-island>`;
}

const paragraph =
  '<p class="text">lorem ipsum dolor sit amet, <a href="/x">consectetur</a> adipiscing elit &amp; more</p>\n';

function document(islands: string[], sizeKb: number): string {
  const body: string[] = [];
  let size = 0;

  while (size < sizeKb * 1024) {
    body.push(paragraph);
    size += paragraph.length;
  }

  const step = Math.max(1, Math.floor(body.length / (islands.length + 1)));

  islands.forEach((tag, i) => body.splice((i + 1) * step, 0, tag));

  return `<!doctype html><html><head><title>bench</title></head><body>${body.join('')}</body></html>`;
}

// chunked like a streamed response would arrive
function chunk(html: string, size = 16 * 1024): string[] {
  const chunks: string[] = [];

  for (let i = 0; i < html.length; i += size) {
    chunks.push(html.slice(i, i + size));
  }

  return chunks;
}

const transformer = createIslandsTransformer(manifest);

const docs = {
  plain: chunk(document([], 50)),
  one: chunk(document([island('load')], 50)),
  twentyImmediate: chunk(
    document(
      Array.from({ length: 20 }, () => island('load')),
      50,
    ),
  ),
  twentyDeferred: chunk(
    document(
      Array.from({ length: 20 }, () => island('visible')),
      50,
    ),
  ),
  twentyWithProps: chunk(
    document(
      Array.from({ length: 20 }, () => island('load', PROPS)),
      50,
    ),
  ),
};

async function run(chunks: string[]): Promise<number> {
  const rewriter = transformer.createDocumentRewriter();
  let out = 0;

  for (const c of chunks) {
    out += rewriter.write(c).length;
  }

  return out + rewriter.end().length;
}

test('islands rewriter, 50 KB document', async ({ bench }) => {
  await bench.compare(
    bench('no islands', async () => {
      await run(docs.plain);
    }),
    bench('1 immediate island', async () => {
      await run(docs.one);
    }),
    bench('20 immediate islands', async () => {
      await run(docs.twentyImmediate);
    }),
    bench('20 deferred islands', async () => {
      await run(docs.twentyDeferred);
    }),
    bench('20 immediate islands, 2 KB props each', async () => {
      await run(docs.twentyWithProps);
    }),
  );
});
