import fs from 'node:fs';
import path from 'node:path';
import { defined } from '@entwico/dash';
import type { Plugin } from 'vite';
import { collectRouteIslands, stripQuery } from './route-islands.js';
import type { IslandsManifest } from './types.js';

export const ISLANDS_VIRTUAL_MODULE_ID = 'virtual:@astroscope/node/islands-manifest';

const RESOLVED_ISLANDS_VIRTUAL_MODULE_ID = `\0${ISLANDS_VIRTUAL_MODULE_ID}`;

const MANIFEST_FILE_NAME = 'islands-manifest.json';

export type IslandsManifestPluginOptions = {
  logger: { warn: (message: string) => void };
  /** `islands: false` disables the preloading — no manifest is written and the virtual module resolves to null */
  enabled: boolean;
  /** page components (absolute paths) → the route patterns they serve, from `astro:routes:resolved` */
  pages: () => Map<string, string[]>;
};

/**
 * Build side of island preloading: the server build attributes islands to routes
 * (its module graph is the only place a page's components are visible together),
 * the client build records the chunk import graph (direct static and dynamic edges
 * per chunk), embeds the gate runtime source (inlined into documents rather than
 * shipped as an asset — an external fetch would install the gates a round-trip
 * after astro's inline island machinery), and drops the manifest next to the
 * server chunks, mirroring the i18n manifest.
 *
 * The client build runs after the server build, so the SSR bundle can only carry
 * code that reads the file lazily; in dev there is no manifest and the middleware
 * stays inert.
 */
export function createIslandsManifestPlugin(options: IslandsManifestPluginOptions): Plugin {
  let isBuild = false;
  // island component ids per route pattern, carried from the server build to the client build
  const routeIslands = new Map<string, Set<string>>();

  return {
    name: '@astroscope/node/islands-manifest',

    configResolved(config) {
      isBuild = config.command === 'build';
    },

    resolveId(id) {
      if (id === ISLANDS_VIRTUAL_MODULE_ID) return RESOLVED_ISLANDS_VIRTUAL_MODULE_ID;
    },

    load(id) {
      if (id !== RESOLVED_ISLANDS_VIRTUAL_MODULE_ID) return;

      if (!isBuild || !options.enabled) {
        return 'export const manifest = null;';
      }

      // the manifest only exists after the client build — read it at runtime. astro
      // bundles middleware at the server root and service code under chunks/, so
      // probe both relative to wherever this module ended up
      return `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

let manifest = null;

for (const candidate of [
  join(dir, '${MANIFEST_FILE_NAME}'),
  join(dir, 'chunks', '${MANIFEST_FILE_NAME}'),
  join(dir, '..', 'chunks', '${MANIFEST_FILE_NAME}'),
]) {
  try {
    manifest = JSON.parse(readFileSync(candidate, 'utf-8'));
    break;
  } catch {
    manifest = null;
  }
}

export { manifest };
`;
    },

    async generateBundle() {
      if (!options.enabled || this.environment.name === 'client') return;

      const { routes } = await collectRouteIslands(this, options.pages());

      for (const [pattern, islands] of routes) {
        routeIslands.set(pattern, islands);
      }
    },

    writeBundle(outputOptions, bundle) {
      if (!options.enabled || this.environment.name !== 'client' || !outputOptions.dir) return;

      const chunks: IslandsManifest['chunks'] = {};
      const entryByComponent = new Map<string, string>();

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;

        chunks[chunk.fileName] = {
          ...(chunk.imports.length > 0 && { i: chunk.imports }),
          ...(chunk.dynamicImports.length > 0 && { d: chunk.dynamicImports }),
        };

        // island components are the client build's entries
        if (chunk.isEntry && chunk.facadeModuleId) {
          entryByComponent.set(stripQuery(chunk.facadeModuleId), chunk.fileName);
        }
      }

      const routes: NonNullable<IslandsManifest['routes']> = {};

      for (const [pattern, islands] of routeIslands) {
        routes[pattern] = [...islands].map((component) => entryByComponent.get(component)).filter(defined);
      }

      const runtimeSource = fs.readFileSync(new URL('./islands-runtime.iife.js', import.meta.url), 'utf-8').trim();

      // the source goes verbatim into an inline script tag
      if (runtimeSource.toLowerCase().includes('</script')) {
        throw new Error('islands gate runtime must not contain "</script"');
      }

      const manifest: IslandsManifest = { runtimeSource, chunks, routes };
      const chunksDir = path.resolve(outputOptions.dir, '..', 'server', 'chunks');

      if (fs.existsSync(chunksDir)) {
        fs.writeFileSync(path.join(chunksDir, MANIFEST_FILE_NAME), JSON.stringify(manifest));
      } else {
        options.logger.warn(`server chunks directory not found, cannot write manifest to ${chunksDir}`);
      }
    },
  };
}
