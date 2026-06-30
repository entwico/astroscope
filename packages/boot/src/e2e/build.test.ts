import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { fixtureRoot, skip } from './fixture';

const distServer = path.join(fixtureRoot, 'dist/server');

function findChunk(prefix: string): string {
  const chunkDir = path.join(distServer, 'chunks');
  const files = readdirSync(chunkDir);
  const match = files.find((f) => f.startsWith(prefix) && f.endsWith('.mjs'));

  if (!match) throw new Error(`no ${prefix}* chunk in ${chunkDir} (found: ${files.join(', ')})`);

  return readFileSync(path.join(chunkDir, match), 'utf8');
}

describe.skipIf(skip)('e2e — programmatic astro build', () => {
  beforeAll(async () => {
    rmSync(path.join(fixtureRoot, 'dist'), { recursive: true, force: true });

    const { build } = await import('astro');

    await build({ root: fixtureRoot, logLevel: 'error' });
  }, 60_000);

  test('injects warmup imports for non-prerendered routes + middleware, excludes prerendered/synthetic', () => {
    const entry = readFileSync(path.join(distServer, 'entry.mjs'), 'utf8');

    expect(entry).toContain(`@astroscope/boot/setup`);
    expect(entry).toContain(`__astroscope_bootSetup`);
    expect(entry).toMatch(/const __astroscope_warmup = import\('\.\/chunks\/warmup_[^']+\.mjs'\)/);
    expect(entry).toContain(`await __astroscope_warmup`);

    const warmup = findChunk('warmup_');

    expect(warmup).toContain('Promise.allSettled');
    expect(warmup).toContain('warmup import failed');

    // import quoting and chunk names differ across bundlers: rollup emits single
    // quotes and names the index chunk `index_`; rolldown emits double quotes and
    // derives the index chunk from its parent directory (`pages_`). accept either.
    expect(warmup).toMatch(/import\(['"]\.\/(index|pages)_[^'"]+\.mjs['"]\)/); // src/pages/index.astro
    expect(warmup).toMatch(/import\(['"]\.\/api_[^'"]+\.mjs['"]\)/); // src/pages/api.ts

    // integration-injected routes flow through astro:routes:resolved too
    expect(warmup).toMatch(/import\(['"]\.\/route_[^'"]+\.mjs['"]\)/); // /_actions/[...path]

    expect(warmup).toMatch(/virtual_astro_middleware/);

    // prerendered → static html, no SSR chunk
    expect(warmup).not.toMatch(/import\(['"]\.\/static_[^'"]+\.mjs['"]\)/);

    // synthetic — no real file backs them
    expect(warmup).not.toContain('_server-islands');
    expect(warmup).not.toContain('astro-default-404');
  });

  describe('shipped chunks must be portable (no host-machine paths)', () => {
    // posix-absolute (`/foo/bar`), windows-drive (`C:\\foo`), and pnpm node_modules
    // signature. covers the common ways an absolute path can leak into output.
    // the fixture pattern matches the host-machine absolute root only — bundler
    // module-id annotations (rolldown's `//#region`) are root-relative and portable.
    const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ABSOLUTE_PATH_PATTERNS = [
      { name: 'fixture absolute path', re: new RegExp(escapeRe(fixtureRoot)) },
      { name: 'windows drive path', re: /[A-Z]:\\\\[^"'\s]+/ },
      { name: 'pnpm store reference', re: /node_modules\/\.pnpm\//i },
    ];

    test.each(ABSOLUTE_PATH_PATTERNS)('warmup chunk does not contain $name', ({ re }) => {
      const warmup = findChunk('warmup_');
      const m = warmup.match(re);

      expect(m, m ? `leaked: ${m[0]}` : '').toBeNull();
    });

    test.each(ABSOLUTE_PATH_PATTERNS)('boot chunk does not contain $name', ({ re }) => {
      const boot = findChunk('boot_');
      const m = boot.match(re);

      expect(m, m ? `leaked: ${m[0]}` : '').toBeNull();
    });

    test('astro manifest entryModules keys for boot package are portable virtual ids', () => {
      const entry = readFileSync(path.join(distServer, 'entry.mjs'), 'utf8');

      // both of our chunks must be registered under their virtual ids,
      // never under a filesystem path that varies per build host.
      expect(entry).toContain(`"\\u0000virtual:@astroscope/boot/entry":"chunks/boot_`);
      expect(entry).toContain(`"\\u0000virtual:@astroscope/boot/warmup":"chunks/warmup_`);

      // the user's boot.ts source path must NOT appear as an entryModules key.
      // boot.ts is shorthand-uniqueness enough for this fixture; tighten if needed.
      expect(entry).not.toMatch(/"\/[^"]*\/src\/boot\.ts":/);
    });
  });
});
