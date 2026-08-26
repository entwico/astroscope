import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { WormholeScan } from './scan.js';
import type { WormholeManifest } from './types.js';

export const WORMHOLE_VIRTUAL_MODULE_ID = 'virtual:@astroscope/wormhole/manifest';
export const REGISTRY_VIRTUAL_MODULE_ID = 'virtual:@astroscope/wormhole/registry';

const RESOLVED_VIRTUAL_MODULE_ID = `\0${WORMHOLE_VIRTUAL_MODULE_ID}`;
const RESOLVED_REGISTRY_STUB_ID = `\0${REGISTRY_VIRTUAL_MODULE_ID}`;

const MANIFEST_FILE_NAME = 'wormhole-manifest.json';

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** chunk file name → manifest key, e.g. `_astro/Counter.abc.js` → `Counter.abc` */
function chunkFileNameToName(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf('/') + 1).replace(/\.js$/, '');
}

/**
 * Build-time side of wormhole slicing: scans client modules for `wormholes.<name>`
 * accesses, maps them onto the emitted chunks, and drops the manifest next to the
 * server chunks — where the virtual module reads it back at runtime, mirroring the
 * islands and i18n manifests. Dev needs none of this: without a manifest the
 * middleware ships all open wormholes with every page.
 */
export type WormholeVitePluginOptions = {
  /** absolute path of `src/wormholes.ts` (or `wormholes/index.ts`), null when the project has none */
  registryPath: string | null;
};

export function wormholeVitePlugin(options: WormholeVitePluginOptions): Plugin {
  let isBuild = false;
  const moduleScans = new Map<string, WormholeScan>();

  return {
    name: '@astroscope/wormhole/extract',

    configResolved(config) {
      isBuild = config.command === 'build';
    },

    resolveId(id) {
      if (id === WORMHOLE_VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;

      // the registry virtual resolves straight to the project's own module, so the
      // middleware and user imports share one instance; without a registry file it
      // falls back to an empty stub (the middleware then rejects every value name)
      if (id === REGISTRY_VIRTUAL_MODULE_ID) return options.registryPath ?? RESOLVED_REGISTRY_STUB_ID;
    },

    load(id) {
      if (id === RESOLVED_REGISTRY_STUB_ID) {
        return 'export const wormholes = {};';
      }

      if (id !== RESOLVED_VIRTUAL_MODULE_ID) return;

      if (!isBuild) {
        return 'export const manifest = null;';
      }

      // the manifest only exists after the client build — read it at runtime. astro
      // bundles middleware at the server root and other code under chunks/, so
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

    async transform(code, id) {
      if (!isBuild || (this.environment && this.environment.name !== 'client')) return;
      if (id.includes('node_modules')) return;
      if (!SCAN_EXTENSIONS.some((ext) => id.endsWith(ext))) return;
      if (!code.includes('@astroscope/wormhole')) return;

      // dynamic import keeps the parser out of the SSR runtime bundle
      const { scanWormholeAccess } = await import('./scan.js');
      const scan = scanWormholeAccess(code, id);

      if (scan) {
        moduleScans.set(id, scan);
      }
    },

    writeBundle(outputOptions, bundle) {
      if (this.environment.name !== 'client' || !outputOptions.dir) return;

      const chunks: WormholeManifest['chunks'] = {};
      const chunkNamesByFileName = new Map<string, string[]>();
      const chunkEdges = new Map<string, string[]>();
      const scriptEntries: string[] = [];

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;

        const names = new Set<string>();
        let dynamic = false;

        for (const moduleId of chunk.moduleIds) {
          const scan = moduleScans.get(moduleId);

          scan?.names.forEach((name) => names.add(name));
          dynamic ||= scan?.dynamic ?? false;
        }

        const chunkNames = [...(dynamic ? ['*'] : []), ...names];

        if (chunkNames.length > 0) {
          chunks[chunkFileNameToName(chunk.fileName)] = chunkNames;
        }

        chunkNamesByFileName.set(chunk.fileName, chunkNames);
        chunkEdges.set(chunk.fileName, [...chunk.imports, ...chunk.dynamicImports]);

        // astro `<script>` entries are not islands, so no island emission covers
        // them — their reachable names ship at stream end instead
        if ((chunk.isEntry || chunk.isDynamicEntry) && chunk.facadeModuleId?.includes('astro&type=script')) {
          scriptEntries.push(chunk.fileName);
        }
      }

      const scriptNames = new Set<string>();
      const visited = new Set<string>();

      const walkScripts = (fileName: string): void => {
        if (visited.has(fileName)) return;

        visited.add(fileName);
        chunkNamesByFileName.get(fileName)?.forEach((name) => scriptNames.add(name));
        chunkEdges.get(fileName)?.forEach(walkScripts);
      };

      scriptEntries.forEach(walkScripts);

      const manifest: WormholeManifest = { chunks, scripts: [...scriptNames] };
      const chunksDir = path.resolve(outputOptions.dir, '..', 'server', 'chunks');

      if (fs.existsSync(chunksDir)) {
        fs.writeFileSync(path.join(chunksDir, MANIFEST_FILE_NAME), JSON.stringify(manifest));
      } else {
        console.error(
          `[@astroscope/wormhole] server chunks directory not found, cannot write manifest to ${chunksDir}`,
        );
      }
    },
  };
}
