import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

import type { HyperspaceOptions } from './types.js';

const DEFAULT_BUDGET = 10 * 1024 * 1024; // 10 MB

export default function hyperspace(options: HyperspaceOptions = {}): AstroIntegration {
  const { serve = 'compressible', budget = DEFAULT_BUDGET } = options;

  let clientDir: URL;
  let outDir: URL;

  return {
    name: '@astroscope/hyperspace',
    hooks: {
      'astro:config:setup': ({ addMiddleware, command }) => {
        if (command === 'dev') return;

        addMiddleware({
          entrypoint: '@astroscope/hyperspace/middleware',
          order: 'pre',
        });
      },

      'astro:config:done': ({ config }) => {
        clientDir = config.build.client;
        outDir = config.outDir;
      },

      'astro:build:done': async ({ logger }) => {
        const { compressClientDir } = await import('./compress.js');
        const staticDir = path.join(fileURLToPath(outDir), 'hyperclient');

        await compressClientDir(fileURLToPath(clientDir), staticDir, serve, budget, logger);
      },
    },
  };
}
