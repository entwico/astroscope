/* eslint-disable unicorn/prefer-event-target -- an EventEmitter stands in for chokidar's watcher and node's http server */
import EventEmitter from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createIslandWarmup, scanAstroSource, scanProjectIslands, selectBareSpecifiers } from './island-warmup';

const noopLogger = { info: () => {}, debug: () => {} };

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'island-warmup-'));

  tmpDirs.push(dir);

  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();

  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const ISLAND_PAGE = `---
import Search from '../components/Search';
---
<Search client:visible />
`;

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
    /* eslint-disable unicorn/no-incorrect-template-string-interpolation -- astro source fixture, `{item}` is a jsx expression container */
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
    /* eslint-enable unicorn/no-incorrect-template-string-interpolation */

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

  test('ignores namespaced tags', () => {
    const source = `---
import Icon from './Icon';
---
<svg:Icon client:visible />
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

  test('skips a file that cannot be read and still scans the rest', async () => {
    const dir = makeTmpDir();
    const broken = path.join(dir, 'broken.astro');
    const logger = { info: vi.fn(), debug: vi.fn() };

    fs.writeFileSync(broken, ISLAND_PAGE);
    fs.writeFileSync(path.join(dir, 'index.astro'), ISLAND_PAGE);

    const readFile = fs.promises.readFile.bind(fs.promises);

    vi.spyOn(fs.promises, 'readFile').mockImplementation(((file: string, ...rest: unknown[]) =>
      file === broken
        ? Promise.reject(new Error('EACCES: permission denied'))
        : (readFile as (...args: unknown[]) => unknown)(file, ...rest)) as typeof fs.promises.readFile);

    expect(await scanProjectIslands(dir, logger)).toEqual([
      { importer: path.join(dir, 'index.astro'), specifier: '../components/Search' },
    ]);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining(broken));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
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

    const specifiers = selectBareSpecifiers(islands, root).toSorted((a, b) => a.localeCompare(b));

    expect(specifiers).toEqual([
      '@radix-ui/react-slider',
      'nanostores',
      'nanostores/react',
    ]);
  });
});

describe('createIslandWarmup', () => {
  type Resolved = { id: string; external?: boolean } | null;

  type Hook = (...args: unknown[]) => unknown;

  /** a project with one page per given specifier, each hydrating that import */
  function createProject(specifiers: string[] = []): { root: string; srcDir: string } {
    const root = makeTmpDir();
    const srcDir = path.join(root, 'src');

    fs.mkdirSync(path.join(srcDir, 'pages'), { recursive: true });

    specifiers.forEach((specifier, index) => {
      fs.writeFileSync(path.join(srcDir, 'pages', `page-${index}.astro`), pageHydrating(specifier));
    });

    return { root, srcDir };
  }

  function pageHydrating(specifier: string): string {
    return `---\nimport Island from '${specifier}';\n---\n<Island client:visible />\n`;
  }

  function createServer(resolve: (specifier: string, importer: string) => Resolved | Promise<Resolved>) {
    const resolveId = vi.fn((specifier: string, importer: string) => Promise.resolve(resolve(specifier, importer)));
    const warmupRequest = vi.fn((_url: string) => Promise.resolve());

    return {
      resolveId,
      warmupRequest,
      warmedUrls: () => warmupRequest.mock.calls.map(([url]) => url).toSorted((a, b) => a.localeCompare(b)),
      httpServer: new EventEmitter() as EventEmitter | null,
      watcher: new EventEmitter(),
      environments: { client: { pluginContainer: { resolveId }, warmupRequest } },
    };
  }

  function createPlugin(project: { root: string; srcDir: string }) {
    const logger = { info: vi.fn(), debug: vi.fn() };
    const plugin = createIslandWarmup({ ...project, logger });

    return {
      logger,
      config: plugin.config as unknown as () => Promise<unknown>,
      configureServer: plugin.configureServer as unknown as Hook,
    };
  }

  describe('config', () => {
    test('pre-optimizes the installed packages islands import, leaving the rest to the server start', async () => {
      const project = createProject(['nanostores/react', '../components/Search', '@alias/Chart']);

      fs.mkdirSync(path.join(project.root, 'node_modules', 'nanostores'), { recursive: true });

      const { config, logger } = createPlugin(project);

      expect(await config()).toEqual({ optimizeDeps: { include: ['nanostores/react'] } });
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('3 island(s)'));
    });

    test('contributes no config when no island imports an installed package', async () => {
      const { config } = createPlugin(createProject(['../components/Search']));

      expect(await config()).toBeUndefined();
    });

    test('stays silent in a project without islands', async () => {
      const { config, logger } = createPlugin(createProject());

      expect(await config()).toBeUndefined();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('server start', () => {
    test('warms the island modules only once the server listens, by their root-relative url', async () => {
      const project = createProject(['../components/Search']);
      const { config, configureServer } = createPlugin(project);
      const server = createServer(() => ({ id: path.join(project.srcDir, 'components', 'Search.tsx') }));

      await config();
      configureServer(server);

      expect(server.resolveId).not.toHaveBeenCalled();

      server.httpServer!.emit('listening');

      await vi.waitFor(() => expect(server.warmedUrls()).toEqual(['/src/components/Search.tsx']));
      expect(server.resolveId).toHaveBeenCalledWith(
        '../components/Search',
        path.join(project.srcDir, 'pages', 'page-0.astro'),
      );
    });

    test('warms right away in middleware mode, where no http server will listen', async () => {
      const project = createProject(['../components/Search']);
      const { config, configureServer } = createPlugin(project);
      const server = createServer(() => ({ id: path.join(project.srcDir, 'components', 'Search.tsx') }));

      server.httpServer = null;

      await config();
      configureServer(server);

      await vi.waitFor(() => expect(server.warmedUrls()).toEqual(['/src/components/Search.tsx']));
    });

    test('requests a module outside the project root through /@fs/', async () => {
      const project = createProject(['@workspace/ui/Button']);
      const outside = path.join(makeTmpDir(), 'ui', 'Button.tsx');
      const { config, configureServer } = createPlugin(project);
      const server = createServer(() => ({ id: outside }));

      await config();
      configureServer(server);
      server.httpServer!.emit('listening');

      await vi.waitFor(() => expect(server.warmedUrls()).toEqual([`/@fs/${outside.split(path.sep).join('/')}`]));
    });

    test('resolves every island but warms only local modules, each once', async () => {
      const project = createProject(['./external', './virtual', './dependency', './unresolved', './Local', './Same']);
      const local = path.join(project.srcDir, 'components', 'Local.tsx');
      const resolutions: Record<string, Resolved> = {
        './external': { id: 'https://cdn.example.com/widget.js', external: true },
        './virtual': { id: '\0virtual:widget' },
        './dependency': { id: path.join(project.root, 'node_modules', 'widget', 'index.js') },
        './unresolved': null,
        './Local': { id: local },
        './Same': { id: local },
      };
      const { config, configureServer } = createPlugin(project);
      const server = createServer((specifier) => resolutions[specifier] ?? null);

      await config();
      configureServer(server);
      server.httpServer!.emit('listening');

      await vi.waitFor(() => expect(server.resolveId).toHaveBeenCalledTimes(6));
      await vi.waitFor(() => expect(server.warmedUrls()).toEqual(['/src/components/Local.tsx']));
    });

    test('an island that fails to resolve does not keep the others from warming', async () => {
      const project = createProject(['./Broken', './Fine']);
      const { config, configureServer } = createPlugin(project);
      const server = createServer((specifier) => {
        if (specifier === './Broken') throw new Error('failed to resolve');

        return { id: path.join(project.srcDir, 'components', 'Fine.tsx') };
      });

      await config();
      configureServer(server);
      server.httpServer!.emit('listening');

      await vi.waitFor(() => expect(server.warmedUrls()).toEqual(['/src/components/Fine.tsx']));
    });
  });

  describe('watcher', () => {
    async function startWatching(specifiers: string[] = []) {
      const project = createProject(specifiers);
      const { config, configureServer } = createPlugin(project);
      const server = createServer((specifier) => ({
        id: path.join(project.srcDir, 'components', `${path.basename(specifier)}.tsx`),
      }));

      await config();
      configureServer(server);
      server.httpServer!.emit('listening');

      await vi.waitFor(() => expect(server.resolveId).toHaveBeenCalledTimes(specifiers.length));

      return { project, server };
    }

    test.each(['add', 'change'])('warms the islands of an .astro file on %s', async (event) => {
      const { project, server } = await startWatching();
      const page = path.join(project.srcDir, 'pages', 'new.astro');

      fs.writeFileSync(page, pageHydrating('../components/Added'));
      server.watcher.emit(event, page);

      await vi.waitFor(() => expect(server.warmedUrls()).toEqual(['/src/components/Added.tsx']));
      expect(server.resolveId).toHaveBeenCalledWith('../components/Added', page);
    });

    test('does not warm a module again that the server start already warmed', async () => {
      const { project, server } = await startWatching(['../components/Search']);
      const page = path.join(project.srcDir, 'pages', 'page-0.astro');

      fs.writeFileSync(
        page,
        `---
import Search from '../components/Search';
import Added from '../components/Added';
---
<Search client:visible />
<Added client:visible />
`,
      );
      server.watcher.emit('change', page);

      await vi.waitFor(() => expect(server.resolveId).toHaveBeenCalledWith('../components/Added', page));
      await vi.waitFor(() =>
        expect(server.warmedUrls()).toEqual(['/src/components/Added.tsx', '/src/components/Search.tsx']));
    });

    test('ignores other files, files outside srcDir and files that are gone by the time they are read', async () => {
      const { project, server } = await startWatching();
      const component = path.join(project.srcDir, 'components.tsx');
      const outside = path.join(project.root, 'other', 'page.astro');
      const page = path.join(project.srcDir, 'pages', 'new.astro');

      fs.mkdirSync(path.dirname(outside), { recursive: true });
      fs.writeFileSync(component, pageHydrating('../components/Ignored'));
      fs.writeFileSync(outside, pageHydrating('../components/Ignored'));

      server.watcher.emit('change', component);
      server.watcher.emit('change', outside);
      server.watcher.emit('change', path.join(project.srcDir, 'pages', 'removed.astro'));

      // the events above are handled before this one: once it is warmed, they had their chance
      fs.writeFileSync(page, pageHydrating('../components/Added'));
      server.watcher.emit('change', page);

      await vi.waitFor(() => expect(server.warmedUrls()).toEqual(['/src/components/Added.tsx']));
      expect(server.resolveId).toHaveBeenCalledTimes(1);
    });
  });
});
