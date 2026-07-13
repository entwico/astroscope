import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AstroIntegrationLogger } from 'astro';
import { afterEach, describe, expect, test } from 'vitest';
import { scan } from './scan';

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  label: 'test',
  fork: () => mockLogger,
} as unknown as AstroIntegrationLogger;

let tempDirs: string[] = [];

async function createProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'i18n-scan-'));

  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);

    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));

  tempDirs = [];
});

const tsSource = (key: string, fallback: string) => `
  import { t } from '@astroscope/i18n/translate';
  export function render() {
    return t('${key}', '${fallback}');
  }
`;

describe('scan', () => {
  test('extracts keys from a TypeScript file', async () => {
    const root = await createProject({ 'src/a.ts': tsSource('hello', 'Hello World') });

    const store = await scan({ projectRoot: root, logger: mockLogger, consistency: 'error' });

    expect(store.extractedKeys).toHaveLength(1);
    expect(store.extractedKeys[0]?.key).toBe('hello');
    expect(store.extractedKeys[0]?.meta.fallback).toBe('Hello World');
    expect(store.filesWithI18n.has(path.resolve(root, 'src/a.ts'))).toBe(true);
  });

  test('extracts keys from a TSX file', async () => {
    const root = await createProject({
      'src/Cart.tsx': `
        import { t } from '@astroscope/i18n/translate';
        export function Cart() {
          return <h1>{t('cart.title', 'Shopping Cart')}</h1>;
        }
      `,
    });

    const store = await scan({ projectRoot: root, logger: mockLogger, consistency: 'error' });

    expect(store.extractedKeys.map((k) => k.key)).toEqual(['cart.title']);
  });

  test('extracts keys from an .astro file', async () => {
    const root = await createProject({
      'src/pages/index.astro': `---
import { t } from '@astroscope/i18n/translate';

const title = t('page.title', 'Welcome');
---
<h1>{title}</h1>
`,
    });

    const store = await scan({ projectRoot: root, logger: mockLogger, consistency: 'error' });

    expect(store.extractedKeys.map((k) => k.key)).toEqual(['page.title']);
    expect(store.extractedKeys[0]?.meta.fallback).toBe('Welcome');
  });

  test('skips files without the translate import', async () => {
    const root = await createProject({
      'src/a.ts': `
        export function render() {
          return t('hello', 'Hello World');
        }
      `,
    });

    const store = await scan({ projectRoot: root, logger: mockLogger, consistency: 'error' });

    expect(store.extractedKeys).toEqual([]);
    expect(store.filesWithI18n.size).toBe(0);
  });

  test('skips files inside node_modules', async () => {
    const root = await createProject({
      'src/node_modules/pkg/a.ts': tsSource('hidden', 'Hidden'),
      'src/b.ts': tsSource('visible', 'Visible'),
    });

    const store = await scan({ projectRoot: root, logger: mockLogger, consistency: 'error' });

    expect(store.extractedKeys.map((k) => k.key)).toEqual(['visible']);
  });

  test('skips files outside src', async () => {
    const root = await createProject({ 'scripts/a.ts': tsSource('outside', 'Outside') });

    const store = await scan({ projectRoot: root, logger: mockLogger, consistency: 'error' });

    expect(store.extractedKeys).toEqual([]);
  });

  test('collects keys from multiple files into one store', async () => {
    const root = await createProject({
      'src/a.ts': tsSource('key.a', 'A'),
      'src/nested/b.ts': tsSource('key.b', 'B'),
    });

    const store = await scan({ projectRoot: root, logger: mockLogger, consistency: 'error' });

    expect(store.uniqueKeyCount).toBe(2);
    expect(store.extractedKeys.map((k) => k.key).sort()).toEqual(['key.a', 'key.b']);
    expect(store.fileToKeys.size).toBe(2);
  });

  test('returns empty store for a project without matching files', async () => {
    const root = await createProject({ 'src/readme.md': '# nothing here' });

    const store = await scan({ projectRoot: root, logger: mockLogger, consistency: 'error' });

    expect(store.extractedKeys).toEqual([]);
    expect(store.hasErrors).toBe(false);
  });
});
