import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

import { islandReadonly } from './island-readonly.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tsconfigRootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures');

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: { allowDefaultProject: ['*.tsx', '*.ts'] },
      tsconfigRootDir,
    },
  },
});

const filename = 'test.tsx';

tester.run('island-readonly', islandReadonly, {
  valid: [
    // deeply readonly props
    {
      filename,
      code: `
        interface Props { readonly name: string; readonly items: readonly { readonly id: string }[] }
        function C(p: Props) { return null as any; }
        export const v = <C client:load name="x" items={[]} />;
      `,
    },
    // mutable props, but not hydrated → not an island, not checked
    {
      filename,
      code: `
        interface Props { name: string }
        function C(p: Props) { return null as any; }
        export const v = <C name="x" />;
      `,
    },
    // intrinsic element
    {
      filename,
      code: `export const v = <div class="x" />;`,
    },
    // a namespaced tag names an element, never a component
    {
      filename,
      code: `export const v = <svg:path client:load d="M0 0" />;`,
    },
    // a tag that resolves to nothing has no props to judge
    {
      filename,
      code: `export const v = <Missing client:load name="x" />;`,
    },
    // a component that takes no props has nothing to mutate
    {
      filename,
      code: `
        function C() { return null as any; }
        export const v = <C client:load />;
      `,
    },
  ],
  invalid: [
    // mutable top-level prop
    {
      filename,
      code: `
        interface Props { name: string }
        function C(p: Props) { return null as any; }
        export const v = <C client:load name="x" />;
      `,
      errors: [{ messageId: 'mutable', data: { comp: 'C' } }],
    },
    // readonly top-level but nested array element is mutable
    {
      filename,
      code: `
        interface Props { readonly items: { id: string }[] }
        function C(p: Props) { return null as any; }
        export const v = <C client:load items={[]} />;
      `,
      errors: [{ messageId: 'mutable', data: { comp: 'C' } }],
    },
    // a member expression tag is an island like any other
    {
      filename,
      code: `
        function C(p: { a: { b: string } }) { return null as any; }
        const UI = { C };
        export const v = <UI.C client:load a={{ b: '' }} />;
      `,
      errors: [{ messageId: 'mutable', data: { comp: 'UI.C' } }],
    },
  ],
});

// without type information (a file outside the typed project) the rule stays silent instead of failing the lint run
new RuleTester().run('island-readonly without type information', islandReadonly, {
  valid: [
    {
      filename,
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      code: `
        interface Props { name: string }
        function C(p: Props) { return null as any; }
        export const v = <C client:load name="x" />;
      `,
    },
  ],
  invalid: [],
});
