/* eslint-disable unicorn/no-incorrect-template-string-interpolation -- fixture sources contain mf2 placeholders */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleTester } from '@typescript-eslint/rule-tester';
import type { RuleModule } from '@typescript-eslint/utils/ts-eslint';
import { afterAll, describe, it } from 'vitest';
import { richMessageComponents } from './rich-message-components.js';
import { tMessageValues } from './t-message-values.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tsconfigRootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tests', 'fixtures');

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: { allowDefaultProject: ['*.tsx', '*.ts'] },
      tsconfigRootDir,
    },
  },
});

const filename = 'test.ts';
const declarations = `
  declare function t(key: string, meta: string, values?: Record<string, unknown>): string;
  declare function rich(key: string, meta: string, components?: Record<string, (c: unknown[]) => unknown>, values?: Record<string, unknown>): unknown[];
`;
const code = (source: string) => ({ filename, code: `${declarations}\n${source}` });

tester.run('t-message-values (typed)', tMessageValues as unknown as RuleModule<string>, {
  valid: [
    code(`const values = { name: 'Ada' }; t('greeting', 'Hello {$name}', values);`),
    // a wider object is fine: only missing names are reported for a variable
    code(`declare const user: { name: string; email: string }; t('greeting', 'Hello {$name}', user);`),
    code(`declare const user: { name?: string }; t('greeting', 'Hello {$name}', user);`),
    code(`declare const rest: { name: string }; t('greeting', 'Hello {$name} ({$age})', { ...rest, age: 3 });`),
    code(`declare const values: { name: string } | undefined; t('greeting', 'Hello {$name}', values);`),
    // types that can hold any name
    code(`declare const values: Record<string, unknown>; t('greeting', 'Hello {$name}', values);`),
    code(`declare const values: any; t('greeting', 'Hello {$name}', values);`),
    code(`function f<T extends object>(values: T) { return t('greeting', 'Hello {$name}', values); }`),
  ],
  invalid: [
    {
      ...code(`const values = { nmae: 'Ada' }; t('greeting', 'Hello {$name}', values);`),
      errors: [{ messageId: 'missingValue', data: { name: 'name' } }],
    },
    {
      ...code(`declare const rest: { first: string }; t('greeting', 'Hello {$first} {$last}', { ...rest });`),
      errors: [{ messageId: 'missingValue', data: { name: 'last' } }],
    },
    {
      // a name only some union members have may be absent
      ...code(`declare const values: { name: string } | { title: string }; t('greeting', 'Hello {$name}', values);`),
      errors: [{ messageId: 'missingValue', data: { name: 'name' } }],
    },
    {
      ...code(`declare const values: { count: number }; rich('greeting', 'Hello {$name}', undefined, values);`),
      errors: [{ messageId: 'missingValue', data: { name: 'name' } }],
    },
  ],
});

tester.run('rich-message-components (typed)', richMessageComponents as unknown as RuleModule<string>, {
  valid: [
    code(`const components = { link: (c: unknown[]) => c }; rich('tos', 'Read our {#link}Terms{/link}', components);`),
    code(`declare const components: Record<string, (c: unknown[]) => unknown>; rich('tos', 'Read our {#link}Terms{/link}', components);`),
  ],
  invalid: [
    {
      ...code(`const components = { bold: (c: unknown[]) => c }; rich('tos', 'Read our {#link}Terms{/link}', components);`),
      errors: [{ messageId: 'missingComponent', data: { name: 'link' } }],
    },
  ],
});
