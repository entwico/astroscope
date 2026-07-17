import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@astrojs/compiler-rs';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * Vite discovers island dependencies lazily: astro registers no client entries,
 * so a dep like radix is first seen when an island hydrates. The optimizer then
 * re-runs, bumps the `?v=` hash and every in-flight import gets a
 * "504 Outdated Optimize Dep" — hydration fails until the full reload.
 *
 * This plugin scans `.astro` sources for `client:*` components at config time,
 * puts their bare package imports into `optimizeDeps.include` (initial optimize
 * pass) and warms their local module graphs at server start (vite's
 * `preTransformRequests` crawls static imports recursively), so discovery
 * happens before a browser holds stale URLs.
 */

interface Logger {
  info(msg: string): void;
  debug(msg: string): void;
}

export interface IslandImport {
  /** absolute path of the .astro file rendering the island */
  importer: string;
  /** import specifier of the hydrated component */
  specifier: string;
}

interface AstNode {
  type: string;
  [key: string]: unknown;
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
}

function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);

    return;
  }

  if (typeof node !== 'object' || node === null) return;

  if (isAstNode(node)) visit(node);

  for (const value of Object.values(node)) walk(value, visit);
}

interface ImportDeclarationNode {
  importKind?: string | null;
  source?: { value?: unknown } | null;
  specifiers?: { importKind?: string | null; local?: { name?: unknown } | null }[] | null;
}

/** local binding name → import specifier, from the frontmatter program */
function collectImports(program: unknown): Map<string, string> {
  const imports = new Map<string, string>();

  walk(program, (node) => {
    if (node.type !== 'ImportDeclaration') return;

    const decl = node as ImportDeclarationNode;

    if (decl.importKind === 'type') return;

    const specifier = typeof decl.source?.value === 'string' ? decl.source.value : undefined;

    if (!specifier) return;

    for (const spec of decl.specifiers ?? []) {
      if (spec.importKind === 'type') continue;

      if (typeof spec.local?.name === 'string') {
        imports.set(spec.local.name, specifier);
      }
    }
  });

  return imports;
}

/** the root identifier of a JSX tag: `Foo` → Foo, `Ns.Chart` → Ns */
function tagRootIdentifier(name: unknown): string | undefined {
  let current = name;

  while (isAstNode(current) && current.type === 'JSXMemberExpression') {
    current = (current as unknown as { object?: unknown }).object;
  }

  if (isAstNode(current) && current.type === 'JSXIdentifier') {
    const identifier = current as unknown as { name?: unknown };

    return typeof identifier.name === 'string' ? identifier.name : undefined;
  }

  return undefined;
}

function hasClientDirective(attributes: unknown): boolean {
  if (!Array.isArray(attributes)) return false;

  return attributes.some((attr) => {
    if (!isAstNode(attr) || attr.type !== 'JSXAttribute') return false;

    const name = (attr as unknown as { name?: { name?: unknown } | null }).name;

    return typeof name?.name === 'string' && name.name.startsWith('client:');
  });
}

/**
 * Extract the import specifiers of all hydrated (`client:*`) components from
 * raw `.astro` source. Astro components can't hydrate, so `.astro` specifiers
 * are skipped; dynamic tags without a frontmatter import are invisible here.
 */
export function scanAstroSource(source: string): string[] {
  const { ast } = parse(source);
  const root = ast as { frontmatter?: { program?: unknown } | null; body?: unknown };

  const imports = collectImports(root.frontmatter?.program);

  if (imports.size === 0) return [];

  const specifiers = new Set<string>();

  walk(root.body, (node) => {
    if (node.type !== 'JSXOpeningElement') return;

    const element = node as unknown as { attributes?: unknown; name?: unknown };

    if (!hasClientDirective(element.attributes)) return;

    const rootName = tagRootIdentifier(element.name);

    if (!rootName || /^[a-z]/.test(rootName)) return;

    const specifier = imports.get(rootName);

    if (specifier && !specifier.endsWith('.astro')) {
      specifiers.add(specifier);
    }
  });

  return [...specifiers];
}

/** scan all `.astro` files under `srcDir` for hydrated components */
export async function scanProjectIslands(srcDir: string, logger: Logger): Promise<IslandImport[]> {
  const islands: IslandImport[] = [];

  let entries: fs.Dirent[];

  try {
    entries = await fs.promises.readdir(srcDir, { recursive: true, withFileTypes: true });
  } catch {
    return islands;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.astro'))
    .map((entry) => path.join(entry.parentPath, entry.name));

  await Promise.all(
    files.map(async (file) => {
      try {
        const source = await fs.promises.readFile(file, 'utf8');

        for (const specifier of scanAstroSource(source)) {
          islands.push({ importer: file, specifier });
        }
      } catch (error) {
        // a file mid-edit or unreadable must not break the dev server
        logger.debug(`island scan skipped ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );

  return islands;
}

function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');

  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
}

/**
 * Bare package specifiers resolvable from the project's `node_modules` — these
 * go into `optimizeDeps.include`. Anything else (relative paths, tsconfig
 * aliases, hoisted workspace deps) is resolved through vite at server start;
 * misclassification is harmless, just slightly later discovery.
 */
export function selectBareSpecifiers(islands: IslandImport[], root: string): string[] {
  const bare = new Set<string>();

  for (const { specifier } of islands) {
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) continue;

    if (fs.existsSync(path.join(root, 'node_modules', packageNameOf(specifier)))) {
      bare.add(specifier);
    }
  }

  return [...bare];
}

function toRequestUrl(id: string, root: string): string {
  const normalized = id.split(path.sep).join('/');
  const normalizedRoot = root.split(path.sep).join('/');

  return normalized.startsWith(`${normalizedRoot}/`) ? normalized.slice(normalizedRoot.length) : `/@fs/${normalized}`;
}

export interface IslandWarmupOptions {
  root: string;
  srcDir: string;
  logger: Logger;
}

export function createIslandWarmup(options: IslandWarmupOptions): Plugin {
  const { root, srcDir, logger } = options;

  let islands: IslandImport[] = [];

  const warmIslands = async (server: ViteDevServer, batch: IslandImport[], warmed: Set<string>): Promise<void> => {
    const env = server.environments.client;

    await Promise.all(
      batch.map(async ({ importer, specifier }) => {
        try {
          // resolving through vite also registers still-unknown bare deps with
          // the optimizer — discovery happens now, not at hydration time
          const resolved = await env.pluginContainer.resolveId(specifier, importer);

          if (!resolved || resolved.external) return;
          if (resolved.id.startsWith('\0') || resolved.id.includes('node_modules')) return;
          if (warmed.has(resolved.id)) return;

          warmed.add(resolved.id);

          await env.warmupRequest(toRequestUrl(resolved.id, root));
        } catch {
          // warmup is best-effort; a broken component surfaces on request anyway
        }
      }),
    );
  };

  return {
    name: '@astroscope/node/island-warmup',

    async config() {
      islands = await scanProjectIslands(srcDir, logger);

      const include = selectBareSpecifiers(islands, root);

      if (islands.length > 0) {
        logger.info(`warming ${islands.length} island(s), pre-optimizing ${include.length} dependenc(ies)`);
      }

      return include.length > 0 ? { optimizeDeps: { include } } : undefined;
    },

    configureServer(server) {
      const warmed = new Set<string>();

      // the plugin container is not initialized until the server starts
      // listening — mirror vite's own warmup timing
      if (server.httpServer) {
        server.httpServer.once('listening', () => void warmIslands(server, islands, warmed));
      } else {
        void warmIslands(server, islands, warmed);
      }

      // islands added mid-session get discovered at save time instead of at
      // page load; new bare deps still re-optimize, but before hydration
      const onWatcherEvent = (file: string): void => {
        if (!file.endsWith('.astro') || !file.startsWith(srcDir)) return;

        void fs.promises
          .readFile(file, 'utf8')
          .then((source) => {
            const batch = scanAstroSource(source).map((specifier) => ({ importer: file, specifier }));

            return warmIslands(server, batch, warmed);
          })
          .catch(() => {});
      };

      server.watcher.on('add', onWatcherEvent);
      server.watcher.on('change', onWatcherEvent);
    },
  };
}
