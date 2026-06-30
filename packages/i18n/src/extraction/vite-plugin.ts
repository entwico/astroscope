import fs from 'node:fs';
import path from 'node:path';
import type { AstroIntegrationLogger } from 'astro';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import type { ConsistencyCheckLevel } from '../integration/types.js';
import { chunkIdToName } from '../shared/url.js';
import { ALL_EXTENSIONS, extractKeysFromFile } from './extract.js';
import { KeyStore } from './key-store.js';
import { getGlobalState, getManifest } from './manifest.js';
import { scan } from './scan.js';

const VIRTUAL_MODULE_ID = 'virtual:@astroscope/i18n/manifest';
const isVirtualModuleId = (id: string) => id === VIRTUAL_MODULE_ID || id.startsWith(`${VIRTUAL_MODULE_ID}?`);

const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;
const isResolvedVirtualModuleId = (id: string) =>
  id === RESOLVED_VIRTUAL_MODULE_ID || id.startsWith(`\0${VIRTUAL_MODULE_ID}?`);

// manifest JSON file name (emitted during build)
const MANIFEST_FILE_NAME = 'i18n-manifest.json';

export type I18nVitePluginOptions = {
  logger: AstroIntegrationLogger;
  consistency: ConsistencyCheckLevel;
};

/**
 * Vite plugin for i18n extraction, chunk mapping, and loader injection
 *
 * This plugin:
 * 1. Extracts all t() calls using Babel AST parsing
 * 2. Strips fallback arguments in production builds
 * 3. Maps translation keys to output chunks
 * 4. Generates a manifest for syncing with translation providers
 * 5. Injects translation loader into chunks that use t()
 */
export function i18nVitePlugin(options: I18nVitePluginOptions): Plugin {
  const { logger, consistency } = options;

  const store = new KeyStore(logger, consistency);

  // sync store's computed keys to global state (for dev mode live access)
  const syncGlobalState = () => {
    const state = getGlobalState();
    state.extractedKeys = store.extractedKeys;
    state.version++;
  };

  let isBuild = false;
  let projectRoot = '';

  return {
    name: '@astroscope/i18n/extract',
    enforce: 'pre',

    configResolved(config) {
      const state = getGlobalState();
      state.projectRoot = config.root;

      isBuild = config.command === 'build';
      projectRoot = config.root;
    },

    async configureServer(server) {
      // configureServer can be called during astro build's internal dev server
      // check isProduction to skip eager scanning during build
      if (server.config.isProduction || isBuild) {
        return;
      }

      // in dev mode, eagerly scan all files upfront
      // this ensures all t() calls are found immediately
      // (otherwise vite loads lazily as files are requested)
      const result = await scan({ projectRoot, logger, consistency });

      store.merge(result);

      syncGlobalState();

      logger.info(`dev mode: scanned ${result.fileToKeys.size} files, found ${result.uniqueKeyCount} keys`);
    },

    resolveId(id) {
      if (isVirtualModuleId(id)) {
        return `\0${id}`;
      }
    },

    load(id) {
      if (isResolvedVirtualModuleId(id)) {
        if (isBuild) {
          // in build mode, load manifest from JSON file at runtime
          return `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestJson = JSON.parse(readFileSync(join(__dirname, '${MANIFEST_FILE_NAME}'), 'utf-8'));

export const manifest = manifestJson;
export function getManifest() { return manifestJson; }
`;
        }

        // in dev mode, import the getManifest function from the plugin
        // this provides live access to the extraction state as files are transformed
        return `
import { getManifest as _getManifest } from '@astroscope/i18n/extraction';
export const manifest = { keys: [], chunks: {} };
export function getManifest() { return _getManifest(); }
`;
      }
    },

    async transform(code, filename) {
      // only process included file types
      if (!ALL_EXTENSIONS.some((ext) => filename.endsWith(ext))) {
        return null;
      }

      // skip node_modules
      if (filename.includes('node_modules')) {
        return null;
      }

      // quick check: skip files without i18n translate import
      if (!code.includes('@astroscope/i18n/translate')) {
        return null;
      }

      const result = await extractKeysFromFile({
        filename,
        code,
        logger,
        stripFallbacks: isBuild,
      });

      store.addFileKeys(filename, result.keys);

      syncGlobalState();

      // build mode: return transformed code with source map
      // serialize babel's map to a string: vite accepts string source maps and
      // its structural ExistingRawSourceMap type (vite 8) rejects babel's map shape
      if (isBuild && result.code) {
        return result.map ? { code: result.code, map: JSON.stringify(result.map) } : { code: result.code };
      }

      return null; // dev mode: keep fallbacks
    },

    generateBundle(_, bundle) {
      const state = getGlobalState();

      // reset for each build (server + client run separately)
      state.chunkManifest = {};
      state.importsManifest = {};

      // first pass: collect keys, determine which chunks have i18n, and build direct imports map
      const chunksWithI18n = new Set<string>();
      const chunkNameToFileName = new Map<string, string>();
      const directImports = new Map<string, string[]>(); // chunk → direct imports (chunks only)

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && chunk.moduleIds) {
          const keys = new Set<string>();
          let hasI18nModule = false;

          // collect keys from all (sub)modules in the chunk
          for (const moduleId of chunk.moduleIds) {
            const moduleKeys = store.fileToKeys.get(moduleId);

            moduleKeys?.forEach((k) => keys.add(k));

            if (store.filesWithI18n.has(moduleId)) {
              hasI18nModule = true;
            }
          }

          const chunkName = chunkIdToName(fileName.replace(/\.js$/, '')); // cut .js extension

          if (keys.size) {
            state.chunkManifest[chunkName] = Array.from(keys);
          }

          if (hasI18nModule) {
            chunksWithI18n.add(chunkName);
          }

          chunkNameToFileName.set(chunkName, fileName);

          // store direct imports for flattening later
          const imports: string[] = [];

          for (const importedFile of chunk.imports) {
            const baseName = importedFile.replace(/^.*\//, '').replace(/\.js$/, '');
            const importedChunkName = chunkIdToName(baseName);

            imports.push(importedChunkName);
          }

          directImports.set(chunkName, imports);
        }
      }

      // build flattened imports manifest
      // tracks all direct and indirect imports that have i18n translations
      // circular dependency detection
      const flattenImports = (chunkName: string, visited: Set<string>): string[] => {
        if (visited.has(chunkName)) return []; // circular dependency, stop

        visited.add(chunkName);

        const result = new Set<string>();
        const imports = directImports.get(chunkName) ?? [];

        for (const imported of imports) {
          // add the imported chunk itself if it has i18n translations
          if (state.chunkManifest[imported]) {
            result.add(imported);
          }

          // recursively add all descendants with i18n
          for (const descendant of flattenImports(imported, visited)) {
            result.add(descendant);
          }
        }

        visited.delete(chunkName); // allow visiting from different paths

        return Array.from(result);
      };

      // compute flattened imports for ALL chunks (not just those with i18n)
      // because a chunk without i18n may import chunks that have i18n
      for (const chunkName of directImports.keys()) {
        const flattened = flattenImports(chunkName, new Set());

        if (flattened.length > 0) {
          state.importsManifest[chunkName] = flattened;
        }
      }

      // second pass: inject loaders (prefetch is handled by directives)
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;

        const chunkName = chunkIdToName(fileName.replace(/\.js$/, ''));

        if (!chunksWithI18n.has(chunkName)) continue;

        // simple translation loader - just load own translations
        // prefetching is handled by directives using the imports manifest
        const loaderCode =
          `if(typeof window!=='undefined'&&window.__i18n__){` +
          `const _=window.__i18n__,h=_.hashes[${JSON.stringify(chunkName)}];` +
          `if(h)await import(\`/_i18n/\${_.locale}/${chunkName}.\${h}.js\`);` +
          `}`;

        // inject loader at start of chunk preserving source maps
        const s = new MagicString(chunk.code);

        s.prepend(loaderCode);
        chunk.code = s.toString();

        if (chunk.map) {
          chunk.map = s.generateMap({ hires: true }) as typeof chunk.map;
        }
      }

      logger.info(`manifest: ${Object.keys(state.chunkManifest).length} chunks, ${store.uniqueKeyCount} keys`);

      // fail build if consistency check is set to 'error' and inconsistencies were found
      if (consistency === 'error' && store.hasErrors) {
        throw new Error('i18n: build failed due to translation key inconsistencies');
      }
    },

    writeBundle(outputOptions) {
      // write the manifest JSON file after bundle is written
      // only emit from client build (has full chunk mapping, runs after server build)
      // write to server directory so it's not publicly accessible (same location as the virtual module)
      if (this.environment.name === 'client' && outputOptions.dir) {
        const chunksDir = path.resolve(outputOptions.dir, '..', 'server', 'chunks');
        const manifestPath = path.join(chunksDir, MANIFEST_FILE_NAME);

        if (fs.existsSync(chunksDir)) {
          fs.writeFileSync(manifestPath, JSON.stringify(getManifest()));
        } else {
          logger.error(`server chunks directory not found, cannot write manifest to ${manifestPath}`);
        }
      }
    },
  };
}
