import path from 'node:path';
import url from 'node:url';

/**
 * Resolve the client directory at runtime relative to the built server entry.
 *
 * The build-time client/server URLs are only valid on the build machine; in a
 * container the deploy path differs. Walk up from `import.meta.url` of the
 * bundled server code until the server directory is found, then apply the
 * build-time server→client relative path.
 */
export function resolveClientDir(options: { client: string; server: string }, importMetaUrl: string): string {
  const clientPath = url.fileURLToPath(new URL(options.client));
  const serverPath = url.fileURLToPath(new URL(options.server));
  const rel = path.relative(serverPath, clientPath);
  const serverFolder = path.basename(serverPath);

  let serverEntryFolderURL = path.dirname(importMetaUrl);
  let previous = '';

  while (!serverEntryFolderURL.endsWith(serverFolder)) {
    if (serverEntryFolderURL === previous) {
      throw new Error(
        `[@astroscope/node] could not find the server directory "${serverFolder}" by walking up from "${importMetaUrl}"`,
      );
    }

    previous = serverEntryFolderURL;
    serverEntryFolderURL = path.dirname(serverEntryFolderURL);
  }

  const clientURL = new URL(rel.endsWith('/') ? rel : `${rel}/`, `${serverEntryFolderURL}/entry.mjs`);

  return url.fileURLToPath(clientURL);
}
