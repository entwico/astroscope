import type { APIContext } from 'astro';
import { log } from '../observability/log/index.js';
import { getIslandEmitters } from './emitters.js';
import { createChunkGraph } from './graph.js';
import { type IslandRewriter, createIslandRewriter, encodeAttribute } from './rewriter.js';
import type { IslandEmission, IslandInfo, IslandsManifest } from './types.js';

/**
 * Turns the manifest into per-document rewriters: resolves each island's chunk
 * closures, collects emissions (the built-in preloader plus registered emitters),
 * and applies the emission policy —
 *
 * - immediate directives (`load`, `only`) get `<link rel="modulepreload">` tags
 *   before the tag, deduplicated per document; the browser's speculative preload
 *   scanner acts on them from raw bytes, ahead of any script.
 * - deferred directives get an inline script before the first island per
 *   component that registers the links on the preload global, keyed by
 *   `component-url`; the gate runtime fires them by the directive's own
 *   scheduling semantics. A script rather than an attribute: it takes effect at
 *   parse time and its effect survives the island element being removed — the
 *   island tag itself stays untouched.
 *
 * The gate runtime script is injected once, before the first island that needs it,
 * so pages without deferred islands never load it.
 */

/** global registry of preload urls per component-url, written by the transform, read by the gate runtime */
export const PRELOAD_GLOBAL = '__islands__';

const IMMEDIATE_DIRECTIVES = new Set(['load', 'only']);

/** urls cannot contain `</script>`, but escape `<` anyway so no value ever can */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

type ResolvedChunk = { prefix: string; fileName: string };

export type IslandsTransformer = {
  createDocumentRewriter(context?: APIContext | undefined): IslandRewriter;
};

export function createIslandsTransformer(manifest: IslandsManifest): IslandsTransformer {
  const graph = createChunkGraph(manifest);
  const fileNames = Object.keys(manifest.chunks);
  const resolveCache = new Map<string, ResolvedChunk | null>();

  // islands carry public urls (base and asset prefix baked in), the manifest holds
  // dist-relative file names — match by suffix at a path boundary, so the observed
  // prefix maps closures and the runtime script back to public urls with no config
  const resolve = (url: string): ResolvedChunk | null => {
    const cached = resolveCache.get(url);

    if (cached !== undefined) {
      return cached;
    }

    let resolved: ResolvedChunk | null = null;

    for (const fileName of fileNames) {
      if (url.endsWith(fileName)) {
        const boundary = url.length - fileName.length;

        if (boundary === 0 || url[boundary - 1] === '/') {
          resolved = { prefix: url.slice(0, boundary), fileName };
          break;
        }
      }
    }

    resolveCache.set(url, resolved);

    return resolved;
  };

  const createDocumentRewriter = (context?: APIContext | undefined): IslandRewriter => {
    const emittedLinks = new Set<string>();
    const registeredComponents = new Set<string>();
    let runtimeInjected = false;

    return createIslandRewriter((attrs) => {
      const componentUrl = attrs['component-url'];

      if (!componentUrl) {
        return null;
      }

      const component = resolve(componentUrl);

      if (!component) {
        return null;
      }

      const rendererUrl = attrs['renderer-url'] || null;
      const renderer = rendererUrl ? resolve(rendererUrl) : null;

      const closureUrls = (closure: (fileName: string) => string[]): string[] => {
        const urls = new Set([componentUrl, ...closure(component.fileName).map((f) => component.prefix + f)]);

        if (rendererUrl) {
          urls.add(rendererUrl);

          for (const f of renderer ? closure(renderer.fileName) : []) {
            urls.add(renderer!.prefix + f);
          }
        }

        return [...urls];
      };

      const island: IslandInfo = {
        componentUrl,
        rendererUrl,
        client: attrs['client'] || null,
        staticClosure: closureUrls(graph.staticClosure),
        fullClosure: closureUrls(graph.fullClosure),
      };

      const emissions: IslandEmission[] = [{ links: island.staticClosure }];

      for (const emitter of getIslandEmitters()) {
        try {
          const emission = emitter(island, context);

          if (emission) {
            emissions.push(emission);
          }
        } catch (error) {
          // an emitter must never break the page — its contribution is dropped
          log.error({ err: error, componentUrl }, 'island emitter failed');
        }
      }

      const links = [...new Set(emissions.flatMap((e) => e.links ?? []))];
      const html = emissions.map((e) => e.html ?? '').join('');
      const directive = (island.client ?? '').replace(/-x$/, '');

      if (IMMEDIATE_DIRECTIVES.has(directive)) {
        const fresh = links.filter((url) => !emittedLinks.has(url));

        for (const url of fresh) {
          emittedLinks.add(url);
        }

        const prepend =
          html +
          fresh.map((url) => `<link rel="modulepreload" fetchpriority="low" href="${encodeAttribute(url)}">`).join('');

        return { prepend: prepend || undefined };
      }

      if (registeredComponents.has(componentUrl)) {
        return { prepend: html || undefined };
      }

      registeredComponents.add(componentUrl);

      const runtime = runtimeInjected
        ? ''
        : `<script type="module" src="${encodeAttribute(component.prefix + manifest.runtime)}"></script>`;

      runtimeInjected = true;

      const register = `<script>(self.${PRELOAD_GLOBAL}??={})[${jsonForScript(componentUrl)}]=${jsonForScript(links)};</script>`;

      return { prepend: runtime + register + html || undefined };
    });
  };

  return { createDocumentRewriter };
}

export type PageTransformOptions = {
  /** the islands rewriter for this document, when preloading is on (prod with a manifest) */
  rewriter?: IslandRewriter | undefined;
  /** scripts inserted right after the opening `<head>` tag — buffers the response */
  heads: string[];
  /** script factories invoked after the rewriter finished, results appended at stream end */
  ends: (() => string | null)[];
};

/**
 * The single streaming pass over an html page response: chunks go through the
 * islands rewriter (when present), head content is inserted right after the
 * opening `<head>` tag (which requires buffering the whole document — head
 * content is dev-style delivery, where throughput is irrelevant), and end
 * factories run last, strictly after every island passed the rewriter.
 */
export function createPageTransformStream(options: PageTransformOptions): TransformStream<Uint8Array, Uint8Array> {
  const { rewriter, heads, ends } = options;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const buffered = heads.length > 0 ? ([] as string[]) : null;

  const enqueue = (controller: TransformStreamDefaultController<Uint8Array>, text: string): void => {
    if (text) {
      controller.enqueue(encoder.encode(text));
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      let text = decoder.decode(chunk, { stream: true });

      if (rewriter) {
        text = rewriter.write(text);
      }

      if (buffered) {
        buffered.push(text);
      } else {
        enqueue(controller, text);
      }
    },
    async flush(controller) {
      let tail = decoder.decode();

      if (rewriter) {
        tail = (tail ? rewriter.write(tail) : '') + (await rewriter.end());
      }

      if (buffered) {
        const html = buffered.join('') + tail;
        // nothing but the doctype, comments and <html> can precede <head>, so the
        // first match cannot sit inside script raw text
        const head = /<head[^>]*>/i.exec(html);
        const at = head ? head.index + head[0].length : 0;

        enqueue(controller, html.slice(0, at) + heads.join('') + html.slice(at));
      } else {
        enqueue(controller, tail);
      }

      for (const end of ends) {
        try {
          enqueue(controller, end() ?? '');
        } catch (error) {
          // an emitter must never break the page — its contribution is dropped
          log.error({ err: error }, 'document emitter failed');
        }
      }
    },
  });
}
