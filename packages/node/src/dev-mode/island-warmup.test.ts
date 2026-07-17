import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { scanAstroSource, scanProjectIslands, selectBareSpecifiers } from './island-warmup';

const noopLogger = { info: () => {}, debug: () => {} };

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'island-warmup-'));

  tmpDirs.push(dir);

  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('scanAstroSource', () => {
  test('extracts default-imported hydrated components', () => {
    const source = `---
import Counter from '../components/Counter';
---
<Counter client:visible />
`;

    expect(scanAstroSource(source)).toEqual(['../components/Counter']);
  });

  test('extracts named and aliased imports', () => {
    const source = `---
import { Accordion as Acc, Slider } from '@radix-ui/themes';
---
<Acc client:load />
<Slider client:idle />
`;

    expect(scanAstroSource(source)).toEqual(['@radix-ui/themes']);
  });

  test('resolves namespace member tags to the namespace import', () => {
    const source = `---
import * as Widgets from './widgets';
---
<Widgets.Chart client:visible />
`;

    expect(scanAstroSource(source)).toEqual(['./widgets']);
  });

  test('detects client:only components', () => {
    const source = `---
import Modal from './Modal';
---
<Modal client:only="react" />
`;

    expect(scanAstroSource(source)).toEqual(['./Modal']);
  });

  test('finds islands inside expression containers', () => {
    const source = `---
import Card from './Card';

const items = [1, 2, 3];
---
<ul>
  {items.map((item) => (
    <li><Card client:visible id={item} /></li>
  ))}
</ul>
`;

    expect(scanAstroSource(source)).toEqual(['./Card']);
  });

  test('ignores components without a client directive', () => {
    const source = `---
import Static from './Static';
import Hydrated from './Hydrated';
---
<Static />
<Hydrated client:visible />
`;

    expect(scanAstroSource(source)).toEqual(['./Hydrated']);
  });

  test('ignores .astro component imports', () => {
    const source = `---
import Layout from '../layouts/Layout.astro';
---
<Layout client:visible />
`;

    expect(scanAstroSource(source)).toEqual([]);
  });

  test('ignores type-only imports', () => {
    const source = `---
import type Fake from './Fake';
---
<Fake client:visible />
`;

    expect(scanAstroSource(source)).toEqual([]);
  });

  test('ignores lowercase (intrinsic) tags and unimported components', () => {
    const source = `---
const Dynamic = pick();
---
<div client:visible />
<Dynamic client:visible />
`;

    expect(scanAstroSource(source)).toEqual([]);
  });

  test('deduplicates a component hydrated multiple times', () => {
    const source = `---
import Badge from './Badge';
---
<Badge client:visible />
<Badge client:load />
`;

    expect(scanAstroSource(source)).toEqual(['./Badge']);
  });

  test('returns nothing for source without frontmatter', () => {
    expect(scanAstroSource('<div>static</div>')).toEqual([]);
  });
});

describe('scanProjectIslands', () => {
  test('collects islands from nested .astro files with their importer paths', async () => {
    const dir = makeTmpDir();

    fs.mkdirSync(path.join(dir, 'pages', 'deep'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'pages', 'index.astro'),
      `---
import Search from '../components/Search';
---
<Search client:visible />
`,
    );
    fs.writeFileSync(
      path.join(dir, 'pages', 'deep', 'about.astro'),
      `---
import Modal from '@ui/modal';
---
<Modal client:load />
`,
    );
    fs.writeFileSync(path.join(dir, 'pages', 'static.astro'), '<div>no islands</div>');

    const islands = await scanProjectIslands(dir, noopLogger);

    expect(islands).toHaveLength(2);
    expect(islands).toContainEqual({
      importer: path.join(dir, 'pages', 'index.astro'),
      specifier: '../components/Search',
    });
    expect(islands).toContainEqual({
      importer: path.join(dir, 'pages', 'deep', 'about.astro'),
      specifier: '@ui/modal',
    });
  });

  test('returns an empty list for a missing directory', async () => {
    expect(await scanProjectIslands(path.join(makeTmpDir(), 'nope'), noopLogger)).toEqual([]);
  });
});

describe('selectBareSpecifiers', () => {
  test('selects specifiers whose package exists in node_modules, deduplicated', () => {
    const root = makeTmpDir();

    fs.mkdirSync(path.join(root, 'node_modules', '@radix-ui', 'react-slider'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', 'nanostores'), { recursive: true });

    const islands = [
      { importer: '/a.astro', specifier: '@radix-ui/react-slider' },
      { importer: '/b.astro', specifier: '@radix-ui/react-slider' },
      { importer: '/a.astro', specifier: 'nanostores' },
      { importer: '/a.astro', specifier: 'nanostores/react' },
      { importer: '/a.astro', specifier: './local/Component' },
      { importer: '/a.astro', specifier: '@alias/not-installed' },
      { importer: '/a.astro', specifier: '#imports' },
    ];

    expect(selectBareSpecifiers(islands, root).sort()).toEqual([
      '@radix-ui/react-slider',
      'nanostores',
      'nanostores/react',
    ]);
  });
});
