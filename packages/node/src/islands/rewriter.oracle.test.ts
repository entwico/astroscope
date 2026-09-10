import { RewritingStream } from 'parse5-html-rewriting-stream';
import { describe, expect, test } from 'vitest';
import { createIslandRewriter } from './rewriter';
import { P, corpus, expected, strip } from './rewriter.corpus';

/**
 * parse5 — the reference WHATWG tokenizer — as an oracle over the corpus: a
 * fixture that disagrees with it is either a scanner bug or a fixture-authoring
 * mistake, and the property suite cannot tell those apart. The scanner's
 * documented deviations are listed by fixture; for those the oracle must still
 * confirm the direction — the scanner never emits more prepends than parse5.
 */

const DEVIATIONS = new Set([
  'island inside template content is inert',
  'nested template content is inert',
  'self-closing template still opens template content',
  'script inside svg is raw text by name',
  'cdata ends only at ]]>',
]);

function throughParse5(html: string): Promise<{ out: string; attrs: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    const stream = new RewritingStream();
    const chunks: string[] = [];
    const attrs: Record<string, string>[] = [];

    stream.on('data', (chunk: string | Buffer) => chunks.push(chunk.toString()));
    stream.on('startTag', (tag, raw) => {
      if (tag.tagName === 'astro-island') {
        attrs.push(Object.fromEntries(tag.attrs.map((attr) => [attr.name, attr.value])));
        stream.emitRaw(P);
      }

      stream.emitRaw(raw);
    });
    stream.on('error', reject);
    stream.end(html, () => resolve({ out: chunks.join(''), attrs }));
  });
}

function throughScanner(html: string): { out: string; attrs: Record<string, string>[] } {
  const attrs: Record<string, string>[] = [];
  const rewriter = createIslandRewriter((seen) => {
    attrs.push({ ...seen });

    return { prepend: P };
  });

  return { out: rewriter.write(html) + rewriter.end(), attrs };
}

const prepends = (out: string): number => out.split(P).length - 1;

describe('createIslandRewriter — parse5 oracle', () => {
  test.each(corpus)('%s', async (name, fixture) => {
    const html = strip(fixture);
    const reference = await throughParse5(html);
    const scanner = throughScanner(html);

    if (DEVIATIONS.has(name)) {
      expect(reference.out, 'a listed deviation must actually deviate').not.toBe(scanner.out);
      expect(prepends(scanner.out)).toBeLessThanOrEqual(prepends(reference.out));

      return;
    }

    expect(reference.out, 'fixture expectation disagrees with parse5').toBe(expected(fixture));
    expect(scanner.out).toBe(reference.out);
    expect(scanner.attrs).toEqual(reference.attrs);
  });
});
