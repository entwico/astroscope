import { existsSync, readdirSync, rmSync } from 'node:fs';
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

  beforeAll(() => {
    // vitest sets NODE_ENV=test, which flips the react plugin to the dev jsx
    // runtime — that embeds absolute source paths into client chunks and never
    // happens in a real `astro build`
    nodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
  });

  afterAll(() => {
    if (nodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = nodeEnv;
    }
  });

  test.each(demos)(
    '%s build output contains no build machine paths',
    async (name) => {
      const root = path.join(demosRoot, name);

      rmSync(path.join(root, 'dist'), { recursive: true, force: true });

      const { build } = await import('astro');

      await build({ root, logLevel: 'error' });

      expect(findLeakedPaths(path.join(root, 'dist'))).toEqual([]);
    },
    180_000,
  );
});
