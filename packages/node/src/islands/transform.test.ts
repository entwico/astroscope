import { beforeEach, describe, expect, test, vi } from 'vitest';
import { registerIslandEmitter } from './emitters';
import { createIslandsTransformer, insertIntoHead } from './transform';
import type { IslandsManifest } from './types';

const REGISTRY = Symbol.for('@astroscope/node.islandEmitters');

const manifest: IslandsManifest = {
  runtimeSource: '/* gate runtime */',
  chunks: {
    '_astro/Cart.aaa.js': { i: ['_astro/shared.bbb.js'], d: ['_astro/Lazy.ddd.js'] },
    '_astro/shared.bbb.js': {},
    '_astro/client.ccc.js': {},
    '_astro/Lazy.ddd.js': {},
    '_astro/Menu.eee.js': { i: ['_astro/shared.bbb.js'] },
  },
};

function island(client: string, componentUrl = '/_astro/Cart.aaa.js'): string {
  return `<astro-island component-url="${componentUrl}" renderer-url="/_astro/client.ccc.js" client="${client}" opts="{}"></astro-island>`;
}

async function apply(html: string): Promise<string> {
  const rewriter = createIslandsTransformer(manifest).createDocumentRewriter();

  return rewriter.write(html) + rewriter.end();
}

beforeEach(() => {
  (globalThis as Record<symbol, unknown>)[REGISTRY] = [];
});

describe('createIslandsTransformer', () => {
  test('emits deduplicated modulepreload links before an immediate island', async () => {
    const out = await apply(`<body>${island('load')}</body>`);
    const links = out.match(/<link rel="modulepreload" fetchpriority="low" href="([^"]+)">/g) ?? [];

    expect(links).toHaveLength(3);
    expect(out).toContain('href="/_astro/Cart.aaa.js"');
    expect(out).toContain('href="/_astro/shared.bbb.js"');
    expect(out).toContain('href="/_astro/client.ccc.js"');
    expect(out.indexOf('<link')).toBeLessThan(out.indexOf('<astro-island'));
  });

  test('does not preload dynamic imports', async () => {
    expect(await apply(island('load'))).not.toContain('Lazy.ddd.js');
  });

  test('emits each link once per document across immediate islands', async () => {
    const out = await apply(island('load') + island('load', '/_astro/Menu.eee.js'));

    expect(out.match(/href="\/_astro\/shared\.bbb\.js"/g)).toHaveLength(1);
    expect(out.match(/href="\/_astro\/client\.ccc\.js"/g)).toHaveLength(1);
  });

  test('inlines the gate runtime and registers preload data for a deferred island', async () => {
    const out = await apply(island('visible'));

    expect(out).toContain('<script>/* gate runtime */</script>');
    expect(out).toMatch(
      /\(self\.__islands__\?\?=\{\}\)\["\/_astro\/Cart\.aaa\.js"\]=\{"l":\[[^\]]*\/_astro\/shared\.bbb\.js[^\]]*\]\}/,
    );
    expect(out.indexOf('__islands__')).toBeLessThan(out.indexOf('<astro-island'));
    expect(out).not.toContain('<link');
    // the island tag itself stays untouched
    expect(out).toContain(island('visible'));
  });

  test('inlines the runtime once and registers each component once', async () => {
    const out = await apply(island('visible') + island('visible') + island('idle', '/_astro/Menu.eee.js'));

    expect(out.match(/<script>\/\* gate runtime \*\/<\/script>/g)).toHaveLength(1);
    expect(out.match(/\(self\.__islands__\?\?=\{\}\)/g)).toHaveLength(2);
  });

  test('pages without deferred islands never carry the runtime', async () => {
    expect(await apply(island('load'))).not.toContain('/* gate runtime */');
  });

  test('treats -x suffixed directives like their base directive', async () => {
    expect(await apply(island('load-x'))).toContain('<link');
    expect(await apply(island('idle-x'))).toContain('__islands__');
  });

  test('maps closures through the prefix observed on the component url', async () => {
    const out = await apply(island('load', 'https://cdn.example.com/base/_astro/Cart.aaa.js'));

    expect(out).toContain('href="https://cdn.example.com/base/_astro/shared.bbb.js"');
  });

  test('leaves islands with unknown component urls untouched', async () => {
    const html = island('load', '/_astro/Unknown.zzz.js');

    expect(await apply(html)).toBe(html);
  });

  test('merges links from registered emitters', async () => {
    registerIslandEmitter((info) => ({
      links: [`/_i18n/de/${info.componentUrl.split('/').pop()}`],
    }));

    const immediate = await apply(island('load'));

    expect(immediate).toContain('href="/_i18n/de/Cart.aaa.js"');

    const deferred = await apply(island('visible'));

    expect(deferred).toMatch(/\["\/_astro\/Cart\.aaa\.js"\]=\{"l":\[[^\]]*\/_i18n\/de\/Cart\.aaa\.js[^\]]*\]\}/);
  });

  test('registers emitter imports for a deferred island, subtracted from the links', async () => {
    registerIslandEmitter(() => ({
      links: ['/_i18n/de/Cart.aaa.js'],
      imports: ['/_i18n/de/Cart.aaa.js', '/_i18n/de/Lazy.ddd.js'],
    }));

    const out = await apply(island('visible'));
    const entry = /\["\/_astro\/Cart\.aaa\.js"\]=(\{.*?\});<\/script>/.exec(out)?.[1];

    expect(entry).toBeDefined();

    const parsed = JSON.parse(entry!) as { l: string[]; i?: string[] };

    expect(parsed.i).toEqual(['/_i18n/de/Cart.aaa.js', '/_i18n/de/Lazy.ddd.js']);
    expect(parsed.l).not.toContain('/_i18n/de/Cart.aaa.js');
    expect(parsed.l).toContain('/_astro/shared.bbb.js');
  });

  test('immediate islands ignore emitter imports', async () => {
    registerIslandEmitter(() => ({ imports: ['/_i18n/de/Lazy.ddd.js'] }));

    expect(await apply(island('load'))).not.toContain('/_i18n/de/Lazy.ddd.js');
  });

  test('a throwing emitter is dropped without breaking the page', async () => {
    registerIslandEmitter(() => {
      throw new Error('emitter exploded');
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await apply(island('load'));

    expect(out).toContain('<link');
    expect(out).toContain('<astro-island');

    errorSpy.mockRestore();
  });

  test('emitter html is prepended before the tag for every directive and occurrence', async () => {
    let n = 0;

    registerIslandEmitter(() => ({ html: `<script>d${n++}</script>` }));

    const immediate = await apply(island('load'));

    expect(immediate).toMatch(/<script>d0<\/script>(<link [^>]+>)+<astro-island/);

    const deferred = await apply(island('visible') + island('visible'));

    // both occurrences carry their html, only the first the registry script
    expect(deferred.match(/<script>d\d<\/script>/g)).toHaveLength(2);
    expect(deferred.match(/\(self\.__islands__\?\?=\{\}\)/g)).toHaveLength(1);
  });

  test('emitters receive the full closure including dynamic imports', async () => {
    const seen: string[][] = [];

    registerIslandEmitter((info) => {
      seen.push(info.fullClosure);

      return null;
    });

    await apply(island('load'));

    expect(seen[0]).toContain('/_astro/Lazy.ddd.js');
  });
});

describe('insertIntoHead', () => {
  test('inserts before </head>', () => {
    const html = '<html><head><meta charset="utf-8"><title>t</title></head><body></body></html>';

    expect(insertIntoHead(html, '<script>x</script>')).toBe(
      '<html><head><meta charset="utf-8"><title>t</title><script>x</script></head><body></body></html>',
    );
  });

  test('matches the closing tag case-insensitively with trailing whitespace', () => {
    expect(insertIntoHead('<HEAD><title>t</title></HEAD ><body></body>', 'x')).toBe(
      '<HEAD><title>t</title>x</HEAD ><body></body>',
    );
  });

  test('falls back to right after <head> when the closing tag is omitted', () => {
    expect(insertIntoHead('<html><head lang="en"><title>t</title><body></body></html>', 'x')).toBe(
      '<html><head lang="en">x<title>t</title><body></body></html>',
    );
  });

  test('prepends to a document without a head', () => {
    expect(insertIntoHead('<div>fragment</div>', 'x')).toBe('x<div>fragment</div>');
  });
});
