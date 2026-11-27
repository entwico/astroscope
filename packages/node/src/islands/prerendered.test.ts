import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerIslandEmitter } from './emitters';
import { transformPrerenderedHtml } from './prerendered';
import type { IslandsManifest } from './types';

const REGISTRY = Symbol.for('@astroscope/node.islandEmitters');

const manifest: IslandsManifest = {
  runtimeSource: '/* gate runtime */',
  chunks: {
    '_astro/Cart.aaa.js': { i: ['_astro/shared.bbb.js'] },
    '_astro/shared.bbb.js': {},
  },
};

const ISLAND = '<astro-island component-url="/_astro/Cart.aaa.js" client="load" opts="{}"></astro-island>';

let clientDir = '';

function write(file: string, content: string): string {
  const full = path.join(clientDir, file);

  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);

  return full;
}

beforeEach(() => {
  vi.stubGlobal(REGISTRY, []);
  clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'islands-prerendered-'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(clientDir, { recursive: true, force: true });
});

describe('transformPrerenderedHtml', () => {
  test('rewrites html files at any depth and counts the ones that changed', () => {
    const index = write('index.html', `<body>${ISLAND}</body>`);
    const nested = write('blog/post/index.html', `<body>${ISLAND}</body>`);

    write('about/index.html', '<body><p>no islands</p></body>');

    expect(transformPrerenderedHtml(clientDir, manifest)).toBe(2);

    for (const file of [index, nested]) {
      const html = fs.readFileSync(file, 'utf8');

      expect(html).toContain('<link rel="modulepreload" fetchpriority="low" href="/_astro/shared.bbb.js">');
      expect(html).toContain(ISLAND);
    }
  });

  test('leaves a page without resolvable islands untouched on disk', () => {
    const page = write('index.html', '<body><p>static</p></body>');
    const before = new Date('2020-01-01T00:00:00Z');

    fs.utimesSync(page, before, before);

    expect(transformPrerenderedHtml(clientDir, manifest)).toBe(0);
    expect(fs.statSync(page).mtime).toEqual(before);
  });

  test('only touches .html files', () => {
    const script = write('_astro/Cart.aaa.js', `export const html = '${ISLAND}';`);
    const text = write('island.html.txt', ISLAND);

    expect(transformPrerenderedHtml(clientDir, manifest)).toBe(0);
    expect(fs.readFileSync(script, 'utf8')).toBe(`export const html = '${ISLAND}';`);
    expect(fs.readFileSync(text, 'utf8')).toBe(ISLAND);
  });

  test('each file is its own document: links are deduplicated per page, not across pages', () => {
    const first = write('a.html', ISLAND + ISLAND);
    const second = write('b.html', ISLAND);

    transformPrerenderedHtml(clientDir, manifest);

    for (const file of [first, second]) {
      expect(fs.readFileSync(file, 'utf8').match(/href="\/_astro\/shared\.bbb\.js"/g)).toHaveLength(1);
    }
  });

  test('runs island emitters without a request context', () => {
    const contexts: unknown[] = [];

    registerIslandEmitter((_island, context) => {
      contexts.push(context);

      return { html: '<script>/* data */</script>' };
    });

    const page = write('index.html', ISLAND);

    transformPrerenderedHtml(clientDir, manifest);

    expect(contexts).toEqual([undefined]);
    expect(fs.readFileSync(page, 'utf8')).toContain(`<script>/* data */</script>`);
  });

  test('with preloading off only the emitter html is written', () => {
    registerIslandEmitter(() => ({ html: '<script>/* data */</script>' }));

    const page = write('index.html', ISLAND);

    expect(transformPrerenderedHtml(clientDir, manifest, { preload: false })).toBe(1);
    expect(fs.readFileSync(page, 'utf8')).toBe(`<script>/* data */</script>${ISLAND}`);
  });
});
