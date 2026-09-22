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
 *   component that registers `{l: links, i: imports}` on the preload global,
 *   keyed by `component-url`; the gate runtime injects the links and eagerly
 *   `import()`s the imports by the directive's own scheduling semantics. A script
 *   rather than an attribute: it takes effect at parse time and its effect
 *   survives the island element being removed — the island tag itself stays
 *   untouched.
 *
 * The gate runtime is inlined once, before the first island that needs it —
 * pages without deferred islands never carry it, pages with them install the
 * gates at parse time, without an external fetch to lose.
 */

/** global registry of `{l, i}` entries per component-url, written by the transform, read by the gate runtime */
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

    for (const fileName of fileNames) {
      if (url.endsWith(fileName)) {
        const boundary = url.length - fileName.length;

        if (boundary === 0 || url[boundary - 1] === '/') {
          const resolved = { prefix: url.slice(0, boundary), fileName };

          // only hits are cached
          resolveCache.set(url, resolved);

          return resolved;
        }
      }
    }

    return null;
  };

  // islands repeat across requests: closures with the prefix applied, the link
  // tags and the emitter-free register script are computed once per island and
  // shared — bounded by the manifest, since only resolvable islands are cached
  const islands = new Map<string, IslandInfo>();
  const linkTags = new Map<string, string>();
  const registerScripts = new WeakMap<IslandInfo, string>();

  const resolveIsland = (
    componentUrl: string,
    rendererUrl: string | null,
    client: string | null,
  ): IslandInfo | null => {
    const key = `${componentUrl}\n${rendererUrl ?? ''}\n${client ?? ''}`;
    const cached = islands.get(key);

    if (cached) {
      return cached;
    }

    const component = resolve(componentUrl);

    if (!component) {
      return null;
    }

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
      client,
      staticClosure: closureUrls(graph.staticClosure),
      fullClosure: closureUrls(graph.fullClosure),
    };

    islands.set(key, island);

    return island;
  };

  const linkTag = (url: string): string => {
    let tag = linkTags.get(url);

    if (tag === undefined) {
      tag = `<link rel="modulepreload" fetchpriority="low" href="${encodeAttribute(url)}">`;
      linkTags.set(url, tag);
    }

    return tag;
  };

  const registerScript = (componentUrl: string, links: readonly string[], imports: readonly string[]): string => {
    const importSet = new Set(imports);
    const entry: Record<string, readonly string[]> = { l: links.filter((url) => !importSet.has(url)) };

    if (imports.length > 0) {
      entry['i'] = imports;
    }

    return `<script>(self.${PRELOAD_GLOBAL}??={})[${jsonForScript(componentUrl)}]=${jsonForScript(entry)};</script>`;
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

      const island = resolveIsland(componentUrl, attrs['renderer-url'] || null, attrs['client'] || null);

      if (!island) {
        return null;
      }

      const emitters = getIslandEmitters();
      let links: readonly string[] = island.staticClosure;
      let imports: readonly string[] = [];
      let html = '';

      if (emitters.length > 0) {
        const emissions: IslandEmission[] = [{ links: island.staticClosure }];

        for (const emitter of emitters) {
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

        links = [...new Set(emissions.flatMap((e) => e.links ?? []))];
        imports = [...new Set(emissions.flatMap((e) => e.imports ?? []))];
        html = emissions.map((e) => e.html ?? '').join('');
      }

      const directive = (island.client ?? '').replace(/-x$/, '');

      if (IMMEDIATE_DIRECTIVES.has(directive)) {
        let prepend = html;

        for (const url of links) {
          if (!emittedLinks.has(url)) {
            emittedLinks.add(url);
            prepend += linkTag(url);
          }
        }

        return { prepend: prepend || undefined };
      }

      if (registeredComponents.has(componentUrl)) {
        return { prepend: html || undefined };
      }

      registeredComponents.add(componentUrl);

      const runtime = runtimeInjected ? '' : `<script>${manifest.runtimeSource}</script>`;

      runtimeInjected = true;

      let register: string;

      if (emitters.length > 0) {
        register = registerScript(componentUrl, links, imports);
      } else {
        register = registerScripts.get(island) ?? registerScript(componentUrl, links, imports);
        registerScripts.set(island, register);
      }

      return { prepend: runtime + register + html || undefined };
    });
  };

  return { createDocumentRewriter };
}

export type PageTransformOptions = {
  /** the islands rewriter for this document, when preloading is on (prod with a manifest) */
  rewriter?: IslandRewriter | undefined;
  /** scripts inserted at the end of `<head>` — buffers the response */
  heads: string[];
  /** script factories invoked after the rewriter finished, results appended at stream end */
  ends: (() => string | null)[];
};

/**
 * Head content goes before `</head>`, falling back to right after `<head>`, then
 * the document start. End of head rather than start: meta charset, title etc come first
 */
export function insertIntoHead(html: string, content: string): string {
  const close = html.search(/<\/head\s*>/i);

  if (close !== -1) {
    return html.slice(0, close) + content + html.slice(close);
  }

  const open = /<head[^>]*>/i.exec(html);
  const at = open ? open.index + open[0].length : 0;

  return html.slice(0, at) + content + html.slice(at);
}

/**
 * The single streaming pass over an html page response: chunks go through the
 * islands rewriter (when present), head content is inserted into `<head>` (which
 * buffers the whole document — head content is dev-style delivery, where
 * throughput is irrelevant), and end factories run last, strictly after every
 * island passed the rewriter.
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
    flush(controller) {
      let tail = decoder.decode();

      if (rewriter) {
        tail = (tail ? rewriter.write(tail) : '') + rewriter.end();
      }

      if (buffered) {
        const html = buffered.join('') + tail;

        enqueue(controller, insertIntoHead(html, heads.join('')));
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
