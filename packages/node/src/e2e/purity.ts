import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// a machine path is /Users/<name>/ or /home/<name>/ — the required trailing
// slash keeps literal app data like a "/home/google.com.html" route out
const MACHINE_PATH_RE = /\/(?:Users|home)\/[^/"'`\s]+\//;

/**
 * Checks only the artifacts we own: sourcemaps (we enable them; `sources` must
 * stay relative — `sourcesContent` is third-party text, out of scope) and the
 * manifest files written next to the server chunks. Astro's own absolute build
 * paths (SSR manifest urls, compiled component ids) are upstream's to fix.
 */
function isLeaking(file: string): boolean {
  const content = readFileSync(file, 'utf-8');

  if (file.endsWith('.map')) {
    const map = JSON.parse(content) as { sources?: string[]; sourceRoot?: string };

    return [...(map.sources ?? []), map.sourceRoot ?? ''].some((source) => MACHINE_PATH_RE.test(source));
  }

  return MACHINE_PATH_RE.test(content);
}

/**
 * Walk a build output directory and return the astroscope-owned files (relative
 * to `dir`) that contain a build machine path.
 */
export function findLeakedPaths(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const leaked: string[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const abs = path.join(current, entry);

      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (/(\.map|-manifest\.json)$/.test(entry) && isLeaking(abs)) {
        leaked.push(path.relative(dir, abs));
      }
    }
  };

  walk(dir);

  return leaked;
}
