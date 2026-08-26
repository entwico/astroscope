import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { wormholeVitePlugin } from './extraction/vite-plugin.js';

/**
 * Astro integration for wormholes with per-island payload slicing.
 *
 * Resolves the `src/wormholes.ts` registry and exposes it to the middleware as a
 * virtual module, registers the vite plugin that scans client code for
 * `wormholes.<name>` accesses and maps them onto the emitted chunks, and generates
 * the registry type stub that types the `wormholes` proxy. Delivery happens at
 * runtime: the wormhole middleware opens per-request values, and the islands
 * emitter (via `@astroscope/node`) writes each island's slice before its tag.
 */
export default function wormholeIntegration(): AstroIntegration {
  const resolveRegistryPath = (srcDir: URL): string | null =>
    ['wormholes.ts', path.join('wormholes', 'index.ts')]
      .map((candidate) => path.join(fileURLToPath(srcDir), candidate))
      .find((candidate) => fs.existsSync(candidate)) ?? null;

  return {
    name: '@astroscope/wormhole',
    hooks: {
      'astro:config:setup': ({ config, updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [wormholeVitePlugin({ registryPath: resolveRegistryPath(config.srcDir) })],
          },
        });
      },

      'astro:config:done': ({ config, injectTypes, logger }) => {
        const registryPath = resolveRegistryPath(config.srcDir);

        if (!registryPath) {
          logger.warn('no src/wormholes.ts registry found — the wormholes proxy stays untyped');

          return;
        }

        // the specifier is relative to the stub's own directory, whose documented
        // location is `.astro/integrations/<normalized integration name>/` — the
        // url injectTypes returns verifies the assumption below, so a layout change
        // in astro fails loudly at sync time instead of silently untyping the proxy
        const stubFile = path.join(
          fileURLToPath(config.root),
          '.astro',
          'integrations',
          '_astroscope_wormhole',
          'registry.d.ts',
        );
        const relative = path.relative(path.dirname(stubFile), registryPath.replace(/([/\\]index)?\.ts$/, ''));
        const specifier = relative.split(path.sep).join('/');

        const written = injectTypes({
          filename: 'registry.d.ts',
          content:
            `import type { UnwrapWormholes } from '@astroscope/wormhole';\n\n` +
            `declare module '@astroscope/wormhole' {\n` +
            `  interface WormholeRegistry extends UnwrapWormholes<typeof import(${JSON.stringify(specifier)}).wormholes> {}\n` +
            `}\n`,
        });

        if (path.resolve(fileURLToPath(written)) !== path.resolve(stubFile)) {
          logger.error(
            `registry type stub landed at ${fileURLToPath(written)} instead of the expected ${stubFile} — ` +
              `its relative import is now wrong and the wormholes proxy is untyped; please report this to @astroscope/wormhole`,
          );
        }
      },
    },
  };
}
