import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { findLeakedPaths } from './purity';

const demosRoot = path.resolve(fileURLToPath(import.meta.url), '../../../../../demo');

// node-e2e is excluded: server.test.ts builds it and asserts purity there;
// building it here as well would race that build under vitest's file parallelism
const EXCLUDED = new Set(['node-e2e']);

const demos = readdirSync(demosRoot).filter((name) => {
  const dir = path.join(demosRoot, name);

  return (
    !EXCLUDED.has(name) &&
    ['astro.config.ts', 'astro.config.mjs', 'astro.config.js'].some((config) => existsSync(path.join(dir, config))) &&
    existsSync(path.join(dir, 'node_modules'))
  );
});

describe.skipIf(demos.length === 0)('build artifact purity', () => {
  let nodeEnv: string | undefined;
  let outRoot: string;

  beforeAll(() => {
    // vitest sets NODE_ENV=test, which flips the react plugin to the dev jsx
    // runtime — that embeds absolute source paths into client chunks and never
    // happens in a real `astro build`
    nodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';

    outRoot = mkdtempSync(path.join(os.tmpdir(), 'astroscope-purity-'));
  });

  afterAll(() => {
    if (nodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = nodeEnv;
    }

    rmSync(outRoot, { recursive: true, force: true });
  });

  test.each(demos)(
    '%s build output contains no build machine paths',
    async (name) => {
      const root = path.join(demosRoot, name);
      // an isolated outDir: the demos' own dist dirs serve the demo test suites'
      // prod servers, which run in parallel with this file
      const outDir = path.join(outRoot, name);

      const { build } = await import('astro');

      await build({ root, outDir, logLevel: 'error' });

      // findLeakedPaths is vacuous on a missing dir — the build must land here
      expect(readdirSync(outDir).length).toBeGreaterThan(0);
      expect(findLeakedPaths(outDir)).toEqual([]);
    },
    180_000,
  );
});
