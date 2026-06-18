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
  ],
});
