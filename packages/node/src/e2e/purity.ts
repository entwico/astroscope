import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.json', '.map', '.html', '.css', '.svg', '.txt', '.xml']);

// a machine path is /Users/<name>/ or /home/<name>/ — the required trailing
// slash keeps literal app data like a "/home/google.com.html" route out
const MACHINE_PATH_RE = /\/(?:Users|home)\/[^/"'`\s]+\//;

/**
 * Walk a build output directory and return the files (relative to `dir`) whose
 * content still contains a build machine path. Empty result = pure artifact.
 */
export function findLeakedPaths(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const leaked: string[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const abs = path.join(current, entry);

      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (TEXT_EXTENSIONS.has(path.extname(entry)) && MACHINE_PATH_RE.test(readFileSync(abs, 'utf-8'))) {
        leaked.push(path.relative(dir, abs));
      }
    }
  };

  walk(dir);

  return leaked;
}
