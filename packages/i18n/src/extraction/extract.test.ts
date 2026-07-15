import { describe, expect, test } from 'vitest';
import { extractKeysFromFile } from './extract.js';

describe('extractKeysFromFile', () => {
  describe('TypeScript files', () => {
    test('extracts simple t() call with string fallback', async () => {
      const code = `
        import { t } from '@astroscope/i18n/translate';
        function render() {
          return t('hello', 'Hello World');
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'test.ts',
        code,
      });

      expect(result.keys).toHaveLength(1);
      expect(result.keys[0]?.key).toBe('hello');
      expect(result.keys[0]?.meta.fallback).toBe('Hello World');
    });

    test('extracts t() call with object meta', async () => {
      const code = `
        import { t } from '@astroscope/i18n/translate';
        function render() {
          return t('greeting', { fallback: 'Hello {name}', description: 'Greeting message' });
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'test.ts',
        code,
      });

      expect(result.keys).toHaveLength(1);
      expect(result.keys[0]?.key).toBe('greeting');
      expect(result.keys[0]?.meta.fallback).toBe('Hello {name}');
      expect(result.keys[0]?.meta.description).toBe('Greeting message');
    });

    test('extracts multiple t() calls', async () => {
      const code = `
        import { t } from '@astroscope/i18n/translate';
        function render() {
          const a = t('key1', 'Fallback 1');
          const b = t('key2', 'Fallback 2');
          return a + b;
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'test.ts',
        code,
      });

      expect(result.keys).toHaveLength(2);
      expect(result.keys.map((k) => k.key)).toEqual(['key1', 'key2']);
    });

    test('extracts t() with variables definition', async () => {
      const code = `
        import { t } from '@astroscope/i18n/translate';
        function render() {
          return t('cart.items', {
            fallback: '{count, plural, one {# item} other {# items}}',
            variables: {
              count: { fallback: '0', description: 'Number of items' }
            }
          });
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'test.ts',
        code,
      });

      expect(result.keys).toHaveLength(1);
      expect(result.keys[0]?.meta.variables?.['count']).toEqual({
        fallback: '0',
        description: 'Number of items',
      });
    });

    test('ignores non-t() calls', async () => {
      const code = `
        function render() {
          return otherFunction('key', 'value');
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'test.ts',
        code,
      });

      expect(result.keys).toHaveLength(0);
    });
  });

  describe('TSX files', () => {
    test('extracts t() from JSX', async () => {
      const code = `
        import { t } from '@astroscope/i18n/translate';
        export function Component() {
          return <div>{t('title', 'Page Title')}</div>;
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'test.tsx',
        code,
      });

      expect(result.keys).toHaveLength(1);
      expect(result.keys[0]?.key).toBe('title');
    });
  });

  describe('stripFallbacks', () => {
    test('strips fallback when enabled', async () => {
      const code = `
        import { t } from '@astroscope/i18n/translate';
        function render() {
          return t('hello', 'Hello World');
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'test.ts',
        code,
        stripFallbacks: true,
      });

      expect(result.code).toContain("t('hello')");
      expect(result.code).not.toContain('Hello World');
    });

    test('strips fallback but keeps values argument', async () => {
      const code = `
        import { t } from '@astroscope/i18n/translate';
        function render() {
          return t('hello', 'Hello {name}', { name: 'World' });
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'test.ts',
        code,
        stripFallbacks: true,
      });

      expect(result.code).toContain("t('hello', undefined,");
      expect(result.code).toContain('name:');
    });

    test('does not strip fallback when disabled', async () => {
      const code = `
        import { t } from '@astroscope/i18n/translate';
        function render() {
          return t('hello', 'Hello World');
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'test.ts',
        code,
        stripFallbacks: false,
      });

      // code is still returned but fallback is preserved
      expect(result.code).toContain('Hello World');
    });
  });

  describe('compiled Astro output', () => {
    test('extracts from code that looks like compiled Astro', async () => {
      // simulates what Astro compiler outputs - the render function
      const code = `
        import { t } from '@astroscope/i18n/translate';
        function $$render() {
          const $$result = t('page.title', 'Welcome');
          return '<h1>' + $$result + '</h1>';
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'Page.astro',
        code,
      });

      expect(result.keys).toHaveLength(1);
      expect(result.keys[0]?.key).toBe('page.title');
    });

    test('extracts from Astro file with TypeScript type imports', async () => {
      // .astro files use TypeScript by default and can have type imports
      const code = `
        import { t } from '@astroscope/i18n/translate';
        import { type SomeType, someFunction } from './utils';
        function $$render() {
          const $$result = t('cart.title', 'Shopping Cart');
          return '<h1>' + $$result + '</h1>';
        }
      `;

      const result = await extractKeysFromFile({
        filename: 'cart.astro',
        code,
      });

      expect(result.keys).toHaveLength(1);
      expect(result.keys[0]?.key).toBe('cart.title');
    });
  });

  describe('non-extractable meta', () => {
    const extract = (body: string) =>
      extractKeysFromFile({
        filename: 'test.ts',
        code: `import { t } from '@astroscope/i18n/translate';\n${body}`,
      });

    test('reports no errors when every fallback is a static literal', async () => {
      const result = await extract(`
        const a = t('a', 'plain');
        const b = t('b', { fallback: 'object form' });
        const c = t('c', \`untagged template\`);
      `);

      expect(result.errors).toEqual([]);
    });

    test('reports a template literal fallback with expressions', async () => {
      const result = await extract('const x = t("greeting", `Hello ${name}`);');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.key).toBe('greeting');
      expect(result.errors[0]?.reason).toContain('template literal with expressions');
    });

    test('reports a fallback built by concatenation', async () => {
      const result = await extract('const x = t("greeting", { fallback: "Hello " + name });');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.key).toBe('greeting');
      expect(result.errors[0]?.reason).toContain('fallback is not a static string');
    });

    test('reports meta that is neither a string nor an object literal', async () => {
      const result = await extract('const x = t("greeting", someMeta);');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain('neither a static string nor an object literal');
    });

    test('reports a spread in the meta object', async () => {
      const result = await extract('const x = t("greeting", { ...base, description: "d" });');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain('spread element');
    });

    test('reports a non-static per-variable fallback', async () => {
      const result = await extract(
        'const x = t("greeting", { fallback: "Hi {$name}", variables: { name: { fallback: dyn } } });',
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain('variable "name.fallback" is not a static string');
    });

    test('carries the file and reports each offending call separately', async () => {
      const result = await extract(`
        const a = t('one', \`a \${x}\`);
        const b = t('two', \`b \${y}\`);
      `);

      expect(result.errors.map((e) => e.key)).toEqual(['one', 'two']);
      expect(result.errors.every((e) => e.file.endsWith('test.ts'))).toBe(true);
    });

    test('still extracts the key so the manifest stays complete', async () => {
      const result = await extract('const x = t("greeting", `Hello ${name}`);');

      expect(result.keys).toHaveLength(1);
      expect(result.keys[0]?.key).toBe('greeting');
      expect(result.keys[0]?.meta.fallback).toBe('');
    });
  });
});
