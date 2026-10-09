import { describe, expect, test, vi } from 'vitest';
import { type IslandTagHandler, createIslandRewriter } from './rewriter';
import { ISLAND, P, corpus, expected, strip } from './rewriter.corpus';

function rewrite(html: string, onIsland: IslandTagHandler, chunkSize = html.length): string {
  const rewriter = createIslandRewriter(onIsland);
  let out = '';

  for (let i = 0; i < html.length; i += chunkSize) {
    out += rewriter.write(html.slice(i, i + chunkSize));
  }

  return out + rewriter.end();
}

describe('createIslandRewriter', () => {
  test('streams html without islands through unchanged', () => {
    const html = '<!doctype html><html><head><title>x</title></head><body><p>a &lt; b</p></body></html>';
    const onIsland = vi.fn();

    expect(rewrite(html, onIsland)).toBe(html);
    expect(onIsland).not.toHaveBeenCalled();
  });

  test('hands the island attributes to the handler, entities decoded', () => {
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

  test('leaves the island unchanged when the handler returns null', () => {
    const html = `<body>${ISLAND}</body>`;

    expect(rewrite(html, () => null)).toBe(html);
  });

  test('prepends html before the island opening tag', () => {
    const out = rewrite(`<body>${ISLAND}</body>`, () => ({ prepend: '<link href="/x.js">' }));

    expect(out).toBe(`<body><link href="/x.js">${ISLAND}</body>`);
  });

  test('produces identical output for any chunk split', () => {
    const html = `<head><script>if (1 < 2) { var s = "</div>"; }</script></head><body>a<b>c</b>${ISLAND}<p>tail</p></body>`;
    const handler: IslandTagHandler = () => ({ prepend: '<!--p-->' });
    const whole = rewrite(html, handler);

    for (const size of [1, 2, 3, 7, 16]) {
      expect(rewrite(html, handler, size)).toBe(whole);
    }
  });

  test('ignores island markup inside script raw text', () => {
    const html = `<script>document.write('${ISLAND}')</script>`;
    const onIsland = vi.fn();

    expect(rewrite(html, onIsland, 5)).toBe(html);
    expect(onIsland).not.toHaveBeenCalled();
  });

  test('ignores island markup inside all raw-text elements the browser treats as text', () => {
    const onIsland = vi.fn();

    for (const tag of ['noscript', 'iframe', 'textarea', 'title', 'style', 'xmp', 'noembed', 'noframes']) {
      const html = `<${tag}>${ISLAND}</${tag}><p>after</p>`;

      expect(rewrite(html, onIsland, 5)).toBe(html);
    }

    expect(onIsland).not.toHaveBeenCalled();
  });

  test('ignores island markup inside comments', () => {
    const html = `<!-- ${ISLAND} --><p>x</p>`;
    const onIsland = vi.fn();

    expect(rewrite(html, onIsland, 3)).toBe(html);
    expect(onIsland).not.toHaveBeenCalled();
  });

  test('resumes scanning after raw text ends', () => {
    const onIsland = vi.fn(() => null);
    const html = `<script>var a = 2 > 1;</script>${ISLAND}`;

    expect(rewrite(html, onIsland, 4)).toBe(html);
    expect(onIsland).toHaveBeenCalledTimes(1);
  });

  test('a quoted > inside an attribute does not end the tag', () => {
    const html = `<div data-x="a>b">text</div>${ISLAND}`;
    const onIsland = vi.fn(() => null);

    expect(rewrite(html, onIsland, 6)).toBe(html);
    expect(onIsland).toHaveBeenCalledTimes(1);
  });

  test('elements whose name starts like the island are not matched', () => {
    const html = '<astro-islander client="load">x</astro-islander><astro-slot>y</astro-slot>';
    const onIsland = vi.fn();

    expect(rewrite(html, onIsland, 2)).toBe(html);
    expect(onIsland).not.toHaveBeenCalled();
  });

  test('processes every island on the page', () => {
    const onIsland = vi.fn(() => ({ prepend: '<!--n-->' }));
    const html = `${ISLAND}<p>between</p>${ISLAND}`;

    const out = rewrite(html, onIsland, 9);

    expect(onIsland).toHaveBeenCalledTimes(2);
    expect(out.match(/<!--n-->/g)).toHaveLength(2);
  });

  test('handles huge escaped props attributes', () => {
    const props = `{&quot;items&quot;:[${'&quot;x&quot;,'.repeat(500)}&quot;y&quot;]}`;
    const html = `<astro-island component-url="/_astro/C.js" props="${props}" client="load"></astro-island>`;
    const seen: Record<string, string>[] = [];

    const out = rewrite(
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

  test('drops an unterminated tag at end of input, like the browser does', () => {
    const rewriter = createIslandRewriter(() => null);
    const out = rewriter.write('<body><astro-isl') + rewriter.end();

    // whatwg eof-in-tag: a partial tag at eof is never emitted — a browser
    // receiving this aborted response renders `<body>` too
    expect(out).toBe('<body>');
  });
});

describe('createIslandRewriter — tokenizer parity', () => {
  test.each(corpus)('%s', (_name, fixture) => {
    const onIsland = vi.fn(() => ({ prepend: P }));
    const islands = fixture.split('§').length - 1;

    expect(rewrite(strip(fixture), onIsland)).toBe(expected(fixture));
    expect(onIsland).toHaveBeenCalledTimes(islands);
  });

  test('produces identical output and handler calls for every chunk split of every fixture', () => {
    for (const [name, fixture] of corpus) {
      const html = strip(fixture);
      const seen: Record<string, string>[][] = [];

      for (let size = 1; size <= html.length; size++) {
        const calls: Record<string, string>[] = [];
        const out = rewrite(
          html,
          (attrs) => {
            calls.push(attrs);

            return { prepend: P };
          },
          size,
        );

        expect(out, `${name} at chunk size ${size}`).toBe(expected(fixture));
        seen.push(calls);
      }

      for (const calls of seen) {
        expect(calls, name).toEqual(seen[0]);
      }
    }
  });
});

describe('createIslandRewriter — attributes', () => {
  function attrsOf(html: string): Record<string, string> {
    let seen: Record<string, string> | undefined;

    rewrite(html, (attrs) => {
      seen = attrs;

      return null;
    });

    if (!seen) throw new Error('island not seen');

    return seen;
  }

  test('lowercases tag and attribute names', () => {
    expect(attrsOf('<ASTRO-ISLAND COMPONENT-URL="/c.js" Client="load">')).toEqual({
      'component-url': '/c.js',
      client: 'load',
    });
  });

  test('single-quoted, unquoted and valueless attributes', () => {
    expect(attrsOf('<astro-island client=\'load\' component-url=/_astro/C.js uid>')).toEqual({
      client: 'load',
      'component-url': '/_astro/C.js',
      uid: '',
    });
  });

  test('quoted values may contain the other quote and >', () => {
    expect(attrsOf(`<astro-island a='x"y>z' b="x'y>z">`)).toEqual({ a: 'x"y>z', b: 'x\'y>z' });
  });

  test('unquoted values run to whitespace and may contain quotes and =', () => {
    expect(attrsOf(`<astro-island client=a"b'c=d uid=1>`)).toEqual({ client: `a"b'c=d`, uid: '1' });
  });

  test('the first of duplicate attributes wins', () => {
    expect(attrsOf('<astro-island client="load" client="only">')).toEqual({ client: 'load' });
  });

  test('decodes the entities astro emits and numeric references', () => {
    expect(attrsOf('<astro-island x="&amp;&lt;&gt;&quot;&#39;&#65;&#x42;&#X43;">')).toEqual({
      x: `&<>"'ABC`,
    });
  });

  test('leaves unknown and legacy no-semicolon references literal, replaces a null reference', () => {
    expect(attrsOf('<astro-island x="/x?a=1&copy=2&foo;&#0;">')).toEqual({ x: '/x?a=1&copy=2&foo;�' });
  });

  test('normalizes crlf in values, output stays verbatim', () => {
    const html = '<astro-island\r\nclient="lo\r\nad"></astro-island>';
    let seen: Record<string, string> | undefined;

    const out = rewrite(html, (attrs) => {
      seen = attrs;

      return null;
    });

    expect(out).toBe(html);
    expect(seen).toEqual({ client: 'lo\nad' });
  });

  test('replaces a null character in values, output stays verbatim', () => {
    const html = '<astro-island client="a\0b"></astro-island>';
    let seen: Record<string, string> | undefined;

    const out = rewrite(html, (attrs) => {
      seen = attrs;

      return null;
    });

    expect(out).toBe(html);
    expect(seen).toEqual({ client: 'a�b' });
  });
});

describe('createIslandRewriter — end of input', () => {
  function drain(html: string): string {
    const rewriter = createIslandRewriter(() => null);

    return rewriter.write(html) + rewriter.end();
  }

  test('emits an unterminated comment', () => {
    expect(drain('<p>x</p><!-- abc')).toBe('<p>x</p><!-- abc');
  });

  test('emits unterminated raw text', () => {
    expect(drain('<script>var a = 1;')).toBe('<script>var a = 1;');
  });

  test('emits a trailing less-than as text', () => {
    expect(drain('a <')).toBe('a <');
  });

  test('drops an island tag cut inside an attribute value', () => {
    expect(drain('<body><astro-island client="lo')).toBe('<body>');
  });
});
