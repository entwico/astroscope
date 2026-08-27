import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Stable stand-in for the build machine's project root in emitted server code.
 * Only relative relationships matter at runtime (see `resolveClientDir`), so the
 * value is never dereferenced — it just has to be consistent across the bundle.
 */
export const ROOT_PLACEHOLDER = '/_astroscope';

const TEXT_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.json', '.map']);

// absolute module ids pointing into a dependency store hoisted above the project
// root (pnpm workspaces); the prefix before the first node_modules is collapsed,
// the store-relative suffix keeps ids unique and matching. the greedy suffix
// consumes the whole path token so a nested node_modules is not re-matched
const HOISTED_STORE_RE = /(file:\/\/)?\/[^"'`\s]*?\/node_modules\/([^"'`\s]*)/g;

// remaining machine paths outside the root and outside any store (workspace
// siblings, linked package sources): rewritten relative to the root, which keeps
// the mapping unique without shipping the home directory or the layout above root
const MACHINE_PATH_RE = /(file:\/\/)?\/(?:Users|home)\/[^"'`\s]+/g;

function collectFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectFiles(abs, out);
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(abs);
    }
  }
}

/**
 * Replace the build machine's project root in the server build output with a
 * stable placeholder.
 *
 * Astro serializes absolute `file://` config URLs (root, outDir, srcDir, ...)
 * and absolute component module ids into the SSR manifest, and the compiled
 * chunks and sourcemaps carry the same absolute paths. Shipping them makes the
 * artifact irreproducible and leaks the developer's filesystem layout. The
 * replacement is applied uniformly, so manifest keys keep matching the module
 * ids embedded in chunks, and the server→client relative resolution keeps
 * working.
 *
 * Returns the number of files rewritten.
 */
export function stripBuildPaths(serverDir: string, root: string): number {
  const rootFsPosix = root.split(path.sep).join('/').replace(/\/+$/, '');
  const rootUrl = pathToFileURL(rootFsPosix).href;

  const files: string[] = [];

  collectFiles(serverDir, files);

  let rewritten = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const replaced = content
      .replaceAll(rootUrl, `file://${ROOT_PLACEHOLDER}`)
      .replaceAll(rootFsPosix, ROOT_PLACEHOLDER)
      .replace(
        HOISTED_STORE_RE,
        (_, proto: string | undefined, suffix: string) => `${proto ?? ''}${ROOT_PLACEHOLDER}/node_modules/${suffix}`,
      )
      .replace(MACHINE_PATH_RE, (match, proto: string | undefined) => {
        const rel = path.posix.relative(rootFsPosix, proto ? match.slice(proto.length) : match);

        return `${proto ?? ''}${ROOT_PLACEHOLDER}/${rel}`;
      });

    if (replaced !== content) {
      fs.writeFileSync(file, replaced);
      rewritten++;
    }
  }

  return rewritten;
}
