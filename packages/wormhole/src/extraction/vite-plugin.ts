import fs from 'node:fs';
import path from 'node:path';
import { type ExcludePattern, serializeExcludePatterns } from '@astroscope/node/excludes';
import { collectRouteIslands, stripQuery } from '@astroscope/node/islands';
import type { Plugin } from 'vite';
import type { WormholeScan } from './scan.js';
import type { WormholeManifest } from './types.js';

export const WORMHOLE_VIRTUAL_MODULE_ID = 'virtual:@astroscope/wormhole/manifest';
export const REGISTRY_VIRTUAL_MODULE_ID = 'virtual:@astroscope/wormhole/registry';
export const CONFIG_VIRTUAL_MODULE_ID = 'virtual:@astroscope/wormhole/config';

const RESOLVED_VIRTUAL_MODULE_ID = `\0${WORMHOLE_VIRTUAL_MODULE_ID}`;
const RESOLVED_REGISTRY_STUB_ID = `\0${REGISTRY_VIRTUAL_MODULE_ID}`;
const RESOLVED_CONFIG_VIRTUAL_MODULE_ID = `\0${CONFIG_VIRTUAL_MODULE_ID}`;

const MANIFEST_FILE_NAME = 'wormhole-manifest.json';

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
// compiled astro components are plain modules in the server build
const SERVER_SCAN_EXTENSIONS = [...SCAN_EXTENSIONS, '.astro'];

/** chunk file name → manifest key, e.g. `_astro/Counter.abc.js` → `Counter.abc` */
function chunkFileNameToName(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf('/') + 1).replace(/\.js$/, '');
}

/**
 * Build-time side of wormhole slicing: scans modules for `wormholes.<name>`
 * accesses — server modules are attributed to the routes whose page or endpoint
 * reaches them (what the middleware must load), client modules to the emitted
 * chunks (what each island receives) — and drops the manifest next to the server
 * chunks, where the virtual module reads it back at runtime, mirroring the islands
 * and i18n manifests. Dev needs none of this: without a manifest the middleware
 * loads and ships all wormholes with every page.
 */
export type WormholeVitePluginOptions = {
  /** absolute path of `src/wormholes.ts` (or `wormholes/index.ts`), null when the project has none */
  registryPath: string | null;
  /** the middleware's exclude patterns, null for the default */
  exclude: ExcludePattern[] | null;
  /** route modules (absolute ids) → the route patterns they serve, see `routeEntrypoints` of `@astroscope/node/islands` */
  pages: () => Map<string, string[]>;
};

export function wormholeVitePlugin(options: WormholeVitePluginOptions): Plugin {
  let isBuild = false;
  const clientScans = new Map<string, WormholeScan>();
  const serverScans = new Map<string, WormholeScan>();
  // names read on the server per route pattern, and the routes reaching each server
  // module — carried from the server build to the client build, where `<script>`
  // entries are attributed to routes through the component file owning them
  const routeNames = new Map<string, Set<string>>();
  const patternsByFile = new Map<string, Set<string>>();

  return {
    name: '@astroscope/wormhole/extract',

    configResolved(config) {
      isBuild = config.command === 'build';
    },

    resolveId(id) {
      if (id === WORMHOLE_VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
      if (id === CONFIG_VIRTUAL_MODULE_ID) return RESOLVED_CONFIG_VIRTUAL_MODULE_ID;

      // the registry virtual resolves straight to the project's own module, so the
      // middleware and user imports share one instance; without a registry file it
      // falls back to an empty stub (the middleware then opens nothing)
      if (id === REGISTRY_VIRTUAL_MODULE_ID) return options.registryPath ?? RESOLVED_REGISTRY_STUB_ID;
    },

    load(id) {
      if (id === RESOLVED_REGISTRY_STUB_ID) {
        return 'export const wormholes = {};';
      }

      if (id === RESOLVED_CONFIG_VIRTUAL_MODULE_ID) {
        // exclude patterns may contain RegExp — serialized as code, not JSON
        return `export const exclude = ${options.exclude ? serializeExcludePatterns(options.exclude) : 'null'};`;
      }

      // the registry carries the handlers, and with them the project's server code
      if (id === options.registryPath && this.environment?.name === 'client') {
        throw new Error(
          `[@astroscope/wormhole] ${path.relative(process.cwd(), id)} is server-only — client code reads wormholes through the \`wormholes\` proxy from '@astroscope/wormhole'`,
        );
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
      if (!isBuild || !this.environment) return;
      if (id.includes('node_modules')) return;

      const client = this.environment.name === 'client';
      const extensions = client ? SCAN_EXTENSIONS : SERVER_SCAN_EXTENSIONS;
      // astro `<script>` modules carry their language in the query (`?astro&type=script&…&lang.ts`),
      // other virtual variants (`?astroPropagatedAssets`) keep the file's own extension
      const file = extensions.some((ext) => id.endsWith(ext)) ? id : stripQuery(id);

      if (!extensions.some((ext) => file.endsWith(ext))) return;
      if (!code.includes('@astroscope/wormhole')) return;

      // dynamic import keeps the parser out of the SSR runtime bundle
      const { scanWormholeAccess } = await import('./scan.js');
      const scan = scanWormholeAccess(code, file);

      if (scan) {
        (client ? clientScans : serverScans).set(client ? id : stripQuery(id), scan);
      }
    },

    async generateBundle() {
      if (this.environment.name === 'client') return;

      const { routes, patternsByModule } = await collectRouteIslands(this, options.pages());

      for (const pattern of routes.keys()) {
        routeNames.set(pattern, routeNames.get(pattern) ?? new Set());
      }

      for (const [id, patterns] of patternsByModule) {
        const file = stripQuery(id);
        let owners = patternsByFile.get(file);

        if (!owners) {
          owners = new Set();
          patternsByFile.set(file, owners);
        }

        patterns.forEach((pattern) => owners.add(pattern));

        const scan = serverScans.get(file);

        if (!scan) continue;

        for (const pattern of patterns) {
          const names = routeNames.get(pattern)!;

          scan.names.forEach((name) => names.add(name));

          if (scan.dynamic) {
            names.add('*');
          }
        }
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
          const scan = clientScans.get(moduleId);

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

      for (const entry of scriptEntries) {
        const names = new Set<string>();
        const visited = new Set<string>();

        const walk = (fileName: string): void => {
          if (visited.has(fileName)) return;

          visited.add(fileName);
          chunkNamesByFileName.get(fileName)?.forEach((name) => names.add(name));
          chunkEdges.get(fileName)?.forEach(walk);
        };

        walk(entry);
        names.forEach((name) => scriptNames.add(name));

        // the script belongs to the routes reaching the component it sits in;
        // an owner the server build never saw means every route may need it
        const owner = bundle[entry]?.type === 'chunk' ? stripQuery(bundle[entry].facadeModuleId ?? '') : '';
        const owners = patternsByFile.get(owner) ?? routeNames.keys();

        for (const pattern of owners) {
          const route = routeNames.get(pattern);

          names.forEach((name) => route?.add(name));
        }
      }

      const routes: WormholeManifest['routes'] = {};

      for (const [pattern, names] of routeNames) {
        routes[pattern] = [...names];
      }

      const manifest: WormholeManifest = { chunks, scripts: [...scriptNames], routes };
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
