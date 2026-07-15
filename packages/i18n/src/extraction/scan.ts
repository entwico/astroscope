import fs from 'node:fs';
import path from 'node:path';
import type { AstroIntegrationLogger } from 'astro';
import type { ConsistencyCheckLevel } from '../integration/types.js';
import { ALL_EXTENSIONS, extractKeysFromFile } from './extract.js';
import { KeyStore } from './key-store.js';
import { mapErrorsToSource } from './source-map.js';

const GLOB_PATTERN = `src/**/*.{${ALL_EXTENSIONS.map((e) => e.slice(1)).join(',')}}`;

/**
 * Compile .astro file to JS using Astro's compiler.
 * Returns the compiled code and its source map, or null if compilation fails.
 */
async function compileAstro(code: string, filename: string): Promise<{ code: string; map: string } | null> {
  try {
    const { transform } = await import('@astrojs/compiler');
    const result = await transform(code, { filename, sourcemap: 'external' });

    return { code: result.code, map: result.map };
  } catch {
    return null;
  }
}

export type ScanOptions = {
  projectRoot: string;
  logger: AstroIntegrationLogger;
  consistency: ConsistencyCheckLevel;
};

/**
 * Eagerly scan all source files for t() calls.
 * Used in dev mode to extract all keys upfront, instead of waiting for
 * Vite's lazy transform hook to process files on-demand.
 */
export async function scan(options: ScanOptions): Promise<KeyStore> {
  const { projectRoot, logger, consistency } = options;
  const store = new KeyStore(logger, consistency);

  const files: string[] = [];

  for await (const entry of fs.promises.glob(GLOB_PATTERN, {
    cwd: projectRoot,
    exclude: (name) => name === 'node_modules',
  })) {
    files.push(path.resolve(projectRoot, entry));
  }

  const results = await Promise.all(
    files.map(async (file) => {
      let code = await fs.promises.readFile(file, 'utf-8');

      // quick check: skip files without i18n translate import
      if (!code.includes('@astroscope/i18n/translate')) {
        return { file, keys: null, errors: [] };
      }

      // compile .astro files first, keeping the map to report authored positions
      let astroMap: string | undefined;

      if (file.endsWith('.astro')) {
        const compiled = await compileAstro(code, file);

        if (!compiled) {
          return { file, keys: null, errors: [] };
        }

        code = compiled.code;
        astroMap = compiled.map;
      }

      // extract keys
      const result = await extractKeysFromFile({
        filename: file,
        code,
        stripFallbacks: false,
      });

      return {
        file,
        keys: result.keys.length > 0 ? result.keys : null,
        errors: mapErrorsToSource(result.errors, astroMap),
      };
    }),
  );

  for (const { file, keys, errors } of results) {
    if (keys) {
      store.addFileKeys(file, keys);
    }

    store.addFileErrors(file, errors);
  }

  return store;
}
