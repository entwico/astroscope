import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHyperspaceMiddleware } from './middleware.js';

// mirrors @astrojs/node's resolveClientDir.

const SERVER_FOLDER = 'server';

function findServerDir(start: string): string {
  let dir = start;
  let previous = '';

  while (path.basename(dir) !== SERVER_FOLDER) {
    if (dir === previous) {
      throw new Error(
        `[@astroscope/hyperspace] could not find the "${SERVER_FOLDER}" directory walking up from ${start}. The middleware appears to be bundled outside the astro server output.`,
      );
    }

    previous = dir;
    dir = path.dirname(dir);
  }

  return dir;
}

const staticDir = path.join(findServerDir(path.dirname(fileURLToPath(import.meta.url))), '..', 'hyperclient');

export const onRequest = createHyperspaceMiddleware(staticDir);
