import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT_PLACEHOLDER, stripBuildPaths } from './strip-build-paths.js';

function createServerDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-build-paths-'));

  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(dir, name);

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  return dir;
}

describe('stripBuildPaths', () => {
  const root = '/Users/someone/projects/app';

  it('replaces file urls and fs paths uniformly across chunks, manifests, and sourcemaps', () => {
    const dir = createServerDir({
      'entry.mjs': `const manifest = {"rootDir":"file:///Users/someone/projects/app/","outDir":"file:///Users/someone/projects/app/dist/","componentMetadata":[["/Users/someone/projects/app/src/pages/index.astro",{}]]};`,
      'chunks/page.mjs': `createComponent(x, "Page", "/Users/someone/projects/app/node_modules/.pnpm/pkg/file.astro");`,
      'chunks/page.mjs.map': `{"sources":["/Users/someone/projects/app/src/pages/index.astro"]}`,
    });

    const rewritten = stripBuildPaths(dir, root);

    expect(rewritten).toBe(3);
    expect(fs.readFileSync(path.join(dir, 'entry.mjs'), 'utf-8')).toBe(
      `const manifest = {"rootDir":"file://${ROOT_PLACEHOLDER}/","outDir":"file://${ROOT_PLACEHOLDER}/dist/","componentMetadata":[["${ROOT_PLACEHOLDER}/src/pages/index.astro",{}]]};`,
    );
    expect(fs.readFileSync(path.join(dir, 'chunks/page.mjs'), 'utf-8')).toBe(
      `createComponent(x, "Page", "${ROOT_PLACEHOLDER}/node_modules/.pnpm/pkg/file.astro");`,
    );
    expect(fs.readFileSync(path.join(dir, 'chunks/page.mjs.map'), 'utf-8')).toBe(
      `{"sources":["${ROOT_PLACEHOLDER}/src/pages/index.astro"]}`,
    );
  });

  it('collapses store paths hoisted above the project root', () => {
    const dir = createServerDir({
      'entry.mjs': `{"/Users/someone/monorepo/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/dist/index.js":"chunks/x.mjs","u":"file:///Users/someone/monorepo/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/dist/index.js"}`,
    });

    expect(stripBuildPaths(dir, root)).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'entry.mjs'), 'utf-8')).toBe(
      `{"${ROOT_PLACEHOLDER}/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/dist/index.js":"chunks/x.mjs","u":"file://${ROOT_PLACEHOLDER}/node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/dist/index.js"}`,
    );
  });

  it('rewrites machine paths outside the root relative to it', () => {
    const dir = createServerDir({
      'entry.mjs': `createComponent(x, "Layout", "/Users/someone/projects/shared/Layout.astro");`,
    });

    expect(stripBuildPaths(dir, root)).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'entry.mjs'), 'utf-8')).toBe(
      `createComponent(x, "Layout", "${ROOT_PLACEHOLDER}/../shared/Layout.astro");`,
    );
  });

  it('accepts a root with a trailing slash', () => {
    const dir = createServerDir({ 'entry.mjs': `"file:///Users/someone/projects/app/src/x.ts"` });

    expect(stripBuildPaths(dir, `${root}/`)).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'entry.mjs'), 'utf-8')).toBe(`"file://${ROOT_PLACEHOLDER}/src/x.ts"`);
  });

  it('leaves untouched files alone and skips non-text extensions', () => {
    const dir = createServerDir({
      'clean.mjs': `export const x = 1;`,
      'image.png': `/Users/someone/projects/app`,
    });

    expect(stripBuildPaths(dir, root)).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'image.png'), 'utf-8')).toBe('/Users/someone/projects/app');
  });
});
