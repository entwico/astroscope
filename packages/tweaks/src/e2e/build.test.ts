import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { fixtureRoot, skip } from './fixture';

const distClient = path.join(fixtureRoot, 'dist/client');
const distServer = path.join(fixtureRoot, 'dist/server');

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const stat = statSync(abs);

    if (stat.isDirectory()) out.push(...walkFiles(abs));
    else out.push(abs);
  }

  return out;
}

describe.skipIf(skip)('e2e — programmatic astro build', () => {
  beforeAll(async () => {
    rmSync(path.join(fixtureRoot, 'dist'), { recursive: true, force: true });

    const { build } = await import('astro');

    await build({ root: fixtureRoot, logLevel: 'error' });
  }, 120_000);

  describe('client bundle MUST NOT leak source', () => {
    test('no .map files anywhere in dist/client', () => {
      const maps = walkFiles(distClient).filter((f) => f.endsWith('.map'));

      expect(maps, maps.length ? `leaked maps: ${maps.join(', ')}` : '').toEqual([]);
    });

    test('no //# sourceMappingURL= marker in any client JS file', () => {
      const jsFiles = walkFiles(distClient).filter((f) => /\.[mc]?js$/.test(f));
      const offenders: string[] = [];

      for (const f of jsFiles) {
        const code = readFileSync(f, 'utf8');

        if (code.includes('//# sourceMappingURL=')) offenders.push(f);
      }

      expect(offenders, offenders.length ? `leaked refs: ${offenders.join(', ')}` : '').toEqual([]);
    });
  });

  describe('SSR bundle keeps sourcemaps for server stack traces', () => {
    test('at least one .map exists in dist/server', () => {
      const maps = walkFiles(distServer).filter((f) => f.endsWith('.map'));

      expect(maps.length).toBeGreaterThan(0);
    });
  });

  describe('strip-effects removes the SSR useEffect body', () => {
    const CANARY = '__tweaks_canary_marker__';

    test('the canary marker is NOT in any SSR chunk', () => {
      const jsFiles = walkFiles(distServer).filter((f) => /\.m?js$/.test(f));
      const offenders = jsFiles.filter((f) => readFileSync(f, 'utf8').includes(CANARY));

      expect(offenders, offenders.length ? `canary leaked into SSR: ${offenders.join(', ')}` : '').toEqual([]);
    });

    test('the canary marker IS in the client bundle', () => {
      const jsFiles = walkFiles(distClient).filter((f) => /\.[mc]?js$/.test(f));
      const hits = jsFiles.filter((f) => readFileSync(f, 'utf8').includes(CANARY));

      expect(hits.length).toBeGreaterThan(0);
    });
  });
});
