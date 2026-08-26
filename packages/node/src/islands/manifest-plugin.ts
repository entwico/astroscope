import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { IslandsManifest } from './types.js';

export const ISLANDS_VIRTUAL_MODULE_ID = 'virtual:@astroscope/node/islands-manifest';

const RESOLVED_ISLANDS_VIRTUAL_MODULE_ID = `\0${ISLANDS_VIRTUAL_MODULE_ID}`;

const MANIFEST_FILE_NAME = 'islands-manifest.json';

export type IslandsManifestPluginOptions = {
  /** astro's `build.assets` directory name, e.g. `_astro` */
  assetsDir: string;
  logger: { warn: (message: string) => void };
  /** `islands: false` disables the preloading — no manifest is written and the virtual module resolves to null */
  enabled: boolean;
};

/**
 * Client-build side of island preloading: records the chunk import graph (direct
 * static and dynamic edges per chunk), writes the content-hashed gate runtime into
 * the client assets dir, and drops the manifest next to the server chunks — where
 * the virtual module reads it back at runtime, mirroring the i18n manifest.
 *
 * The client build runs after the server build, so the SSR bundle can only carry
 * code that reads the file lazily; in dev there is no manifest and the middleware
 * stays inert.
 */
export function createIslandsManifestPlugin(options: IslandsManifestPluginOptions): Plugin {
  let isBuild = false;

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

    writeBundle(outputOptions, bundle) {
      if (!options.enabled || this.environment.name !== 'client' || !outputOptions.dir) return;

      const chunks: IslandsManifest['chunks'] = {};

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;

        chunks[chunk.fileName] = {
          ...(chunk.imports.length > 0 && { i: chunk.imports }),
          ...(chunk.dynamicImports.length > 0 && { d: chunk.dynamicImports }),
        };
      }

      // the sourcemap itself is not shipped, so the marker would 404 (and client
      // bundles are deliberately map-free, see tweaks/sourcemap.ts)
      const runtimeSource = fs
        .readFileSync(new URL('./islands-runtime.js', import.meta.url), 'utf-8')
        .replace(/^\/\/# sourceMappingURL=.*$/m, '')
        .trimEnd();
      const hash = createHash('sha256').update(runtimeSource).digest('hex').slice(0, 8);
      const runtime = `${options.assetsDir}/islands-runtime.${hash}.js`;

      fs.mkdirSync(path.join(outputOptions.dir, options.assetsDir), { recursive: true });
      fs.writeFileSync(path.join(outputOptions.dir, options.assetsDir, `islands-runtime.${hash}.js`), runtimeSource);

      const manifest: IslandsManifest = { runtime, chunks };
      const chunksDir = path.resolve(outputOptions.dir, '..', 'server', 'chunks');

      if (fs.existsSync(chunksDir)) {
        fs.writeFileSync(path.join(chunksDir, MANIFEST_FILE_NAME), JSON.stringify(manifest));
      } else {
        options.logger.warn(`server chunks directory not found, cannot write manifest to ${chunksDir}`);
      }
    },
  };
}
