import { RewritingStream } from 'parse5-html-rewriting-stream';

/**
 * Streaming HTML rewriter that finds `<astro-island …>` opening tags, hands their
 * attributes to a handler, and prepends the handler's html before the tag — the
 * tag itself is always re-emitted from its raw source, byte-verbatim.
 *
 * Tokenization is parse5's — the reference WHATWG implementation — so every
 * context where island markup is not actually an element to the browser
 * (comments, raw-text elements like `script`/`iframe`/`noscript`, doctypes,
 * quoted attribute values) is skipped by construction rather than by our own
 * spec-tracking; unmodified content passes through as raw source slices.
 * Attribute values arrive with the full entity set decoded.
 *
 * Closing tags are never touched: injection happens before the island's opening
 * tag precisely so the island's subtree — the hydration target — stays untouched.
 *
 * The test suite pins the behavior this package relies on, so a parse5 upgrade
 * that changes it fails here rather than degrading silently — same philosophy as
 * the astro compatibility surface.
 */

export type IslandTagRewrite = {
  /** html emitted immediately before the island opening tag */
  prepend?: string | undefined;
};

export type IslandTagHandler = (attrs: Record<string, string>) => IslandTagRewrite | null;

export type IslandRewriter = {
  write(chunk: string): string;
  end(): Promise<string>;
};

const ISLAND = 'astro-island';

export function encodeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function createIslandRewriter(onIsland: IslandTagHandler): IslandRewriter {
  const stream = new RewritingStream();
  const out: string[] = [];

  stream.on('data', (chunk: string | Buffer) => {
    out.push(typeof chunk === 'string' ? chunk : chunk.toString());
  });

  stream.on('startTag', (tag, rawHtml) => {
    if (tag.tagName === ISLAND) {
      const attrs: Record<string, string> = {};

      for (const attr of tag.attrs) {
        attrs[attr.name] = attr.value;
      }

      const rewrite = onIsland(attrs);

      if (rewrite?.prepend) {
        stream.emitRaw(rewrite.prepend);
      }
    }

    stream.emitRaw(rawHtml);
  });

  const drain = (): string => out.splice(0).join('');

  return {
    // a transform stream with an attached data listener processes writes
    // synchronously, so each write can hand back its output right away
    write(chunk) {
      stream.write(chunk);

      return drain();
    },
    end() {
      return new Promise((resolve, reject) => {
        stream.once('error', reject);
        stream.end(() => resolve(drain()));
      });
    },
  };
}
