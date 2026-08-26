import { describe, expect, test, vi } from 'vitest';
import { type IslandTagHandler, createIslandRewriter } from './rewriter';

async function rewrite(html: string, onIsland: IslandTagHandler, chunkSize = html.length): Promise<string> {
  const rewriter = createIslandRewriter(onIsland);
  let out = '';

  for (let i = 0; i < html.length; i += chunkSize) {
    out += rewriter.write(html.slice(i, i + chunkSize));
  }

  return out + (await rewriter.end());
}

const ISLAND =
  '<astro-island uid="a1" component-url="/_astro/Cart.abc.js" renderer-url="/_astro/client.def.js" ' +
  'client="visible" opts="{&quot;name&quot;:&quot;Cart&quot;,&quot;value&quot;:true}"></astro-island>';

describe('createIslandRewriter', () => {
  test('streams html without islands through unchanged', async () => {
    const html = '<!doctype html><html><head><title>x</title></head><body><p>a &lt; b</p></body></html>';
    const onIsland = vi.fn();

    expect(await rewrite(html, onIsland)).toBe(html);
    expect(onIsland).not.toHaveBeenCalled();
  });

  test('hands the island attributes to the handler, entities decoded', async () => {
    const onIsland = vi.fn(() => null);

    rewrite(`<body>${ISLAND}</body>`, onIsland);

    expect(onIsland).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        uid: 'a1',
        'component-url': '/_astro/Cart.abc.js',
        'renderer-url': '/_astro/client.def.js',
        client: 'visible',
        opts: '{"name":"Cart","value":true}',
      }),
    );
  });

  test('leaves the island unchanged when the handler returns null', async () => {
    const html = `<body>${ISLAND}</body>`;

    expect(await rewrite(html, () => null)).toBe(html);
  });

  test('prepends html before the island opening tag', async () => {
    const out = await rewrite(`<body>${ISLAND}</body>`, () => ({ prepend: '<link href="/x.js">' }));

    expect(out).toBe(`<body><link href="/x.js">${ISLAND}</body>`);
  });

  test('produces identical output for any chunk split', async () => {
    const html = `<head><script>if (1 < 2) { var s = "</div>"; }</script></head><body>a<b>c</b>${ISLAND}<p>tail</p></body>`;
    const handler: IslandTagHandler = () => ({ prepend: '<!--p-->' });
    const whole = await rewrite(html, handler);

    for (const size of [1, 2, 3, 7, 16]) {
      expect(await rewrite(html, handler, size)).toBe(whole);
    }
  });

  test('ignores island markup inside script raw text', async () => {
    const html = `<script>document.write('${ISLAND}')</script>`;
    const onIsland = vi.fn();

    expect(await rewrite(html, onIsland, 5)).toBe(html);
    expect(onIsland).not.toHaveBeenCalled();
  });

  test('ignores island markup inside all raw-text elements the browser treats as text', async () => {
    const onIsland = vi.fn();

    for (const tag of ['noscript', 'iframe', 'textarea', 'title', 'style', 'xmp', 'noembed', 'noframes']) {
      const html = `<${tag}>${ISLAND}</${tag}><p>after</p>`;

      expect(await rewrite(html, onIsland, 5)).toBe(html);
    }

    expect(onIsland).not.toHaveBeenCalled();
  });

  test('ignores island markup inside comments', async () => {
    const html = `<!-- ${ISLAND} --><p>x</p>`;
    const onIsland = vi.fn();

    expect(await rewrite(html, onIsland, 3)).toBe(html);
    expect(onIsland).not.toHaveBeenCalled();
  });

  test('resumes scanning after raw text ends', async () => {
    const onIsland = vi.fn(() => null);
    const html = `<script>var a = 2 > 1;</script>${ISLAND}`;

    expect(await rewrite(html, onIsland, 4)).toBe(html);
    expect(onIsland).toHaveBeenCalledTimes(1);
  });

  test('a quoted > inside an attribute does not end the tag', async () => {
    const html = `<div data-x="a>b">text</div>${ISLAND}`;
    const onIsland = vi.fn(() => null);

    expect(await rewrite(html, onIsland, 6)).toBe(html);
    expect(onIsland).toHaveBeenCalledTimes(1);
  });

  test('elements whose name starts like the island are not matched', async () => {
    const html = '<astro-islander client="load">x</astro-islander><astro-slot>y</astro-slot>';
    const onIsland = vi.fn();

    expect(await rewrite(html, onIsland, 2)).toBe(html);
    expect(onIsland).not.toHaveBeenCalled();
  });

  test('processes every island on the page', async () => {
    const onIsland = vi.fn(() => ({ prepend: '<!--n-->' }));
    const html = `${ISLAND}<p>between</p>${ISLAND}`;

    const out = await rewrite(html, onIsland, 9);

    expect(onIsland).toHaveBeenCalledTimes(2);
    expect(out.match(/<!--n-->/g)).toHaveLength(2);
  });

  test('handles huge escaped props attributes', async () => {
    const props = `{&quot;items&quot;:[${'&quot;x&quot;,'.repeat(500)}&quot;y&quot;]}`;
    const html = `<astro-island component-url="/_astro/C.js" props="${props}" client="load"></astro-island>`;
    const seen: Record<string, string>[] = [];

    const out = await rewrite(
      html,
      (attrs) => {
        seen.push(attrs);

        return null;
      },
      64,
    );

    expect(out).toBe(html);
    expect(seen[0]?.['props']).toContain('"items"');
  });

  test('drops an unterminated tag at end of input, like the browser does', async () => {
    const rewriter = createIslandRewriter(() => null);
    const out = rewriter.write('<body><astro-isl') + (await rewriter.end());

    // whatwg eof-in-tag: a partial tag at eof is never emitted — a browser
    // receiving this aborted response renders `<body>` too
    expect(out).toBe('<body>');
  });
});
