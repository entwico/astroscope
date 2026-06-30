import type { FileResult, PluginItem } from '@babel/core';
import type { AstroIntegrationLogger } from 'astro';
import type { ExtractedKeyOccurrence } from './types.js';

/** TypeScript extensions (need 'typescript' babel plugin) */
export const TS_EXTENSIONS = ['.ts', '.tsx'] as const;

/** JSX extensions (need 'jsx' babel plugin) */
export const JSX_EXTENSIONS = ['.jsx', '.tsx'] as const;

/** Plain JS extensions */
export const JS_EXTENSIONS = ['.js', '.jsx'] as const;

/**
 * Extensions that can be parsed directly by Babel (raw source files).
 * Used for eager scanning before Vite processes them.
 */
export const BABEL_EXTENSIONS = [...TS_EXTENSIONS, ...JS_EXTENSIONS] as const;

/**
 * All extensions that may contain t() calls.
 * Includes .astro which requires Astro's compiler before Babel can parse it.
 */
export const ALL_EXTENSIONS = [...BABEL_EXTENSIONS, '.astro'] as const;

export type ExtractOptions = {
  filename: string;
  code: string;
  logger: AstroIntegrationLogger;
  stripFallbacks?: boolean | undefined;
  onKeyExtracted?: ((key: ExtractedKeyOccurrence) => void) | undefined;
};

export type ExtractResult = {
  keys: ExtractedKeyOccurrence[];
  code: string | null;
  map: FileResult['map'];
};

/**
 * Extract keys from a single file using Babel.
 * Optionally strips fallbacks (for production builds).
 */
export async function extractKeysFromFile(options: ExtractOptions): Promise<ExtractResult> {
  const { filename, code, logger, stripFallbacks = false, onKeyExtracted } = options;

  const keys: ExtractedKeyOccurrence[] = [];

  // dynamic imports prevent Babel from being bundled into server runtime
  const [{ transformAsync }, { i18nExtractPlugin }] = await Promise.all([
    import('@babel/core'),
    import('./babel-plugin.js'),
  ]);

  // treat .astro files as TypeScript (otherwise type imports fail)
  const isTypeScript = TS_EXTENSIONS.some((ext) => filename.endsWith(ext)) || filename.endsWith('.astro');
  const isJSX = JSX_EXTENSIONS.some((ext) => filename.endsWith(ext));

  const result = await transformAsync(code, {
    filename,
    sourceMaps: stripFallbacks, // only need source maps when transforming
    babelrc: false,
    configFile: false,
    parserOpts: {
      plugins: [...(isTypeScript ? ['typescript' as const] : []), ...(isJSX ? ['jsx' as const] : [])],
    },
    plugins: [
      [
        i18nExtractPlugin,
        {
          stripFallbacks,
          onKeyExtracted: (key: ExtractedKeyOccurrence) => {
            keys.push(key);
            onKeyExtracted?.(key);
          },
          logger,
        },
      ] as PluginItem,
    ],
  });

  return {
    keys,
    code: result?.code ?? null,
    map: result?.map ?? null,
  };
}
