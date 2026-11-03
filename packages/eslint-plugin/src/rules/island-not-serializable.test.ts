import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

import { islandNotSerializable } from './island-not-serializable.js';

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

tester.run('island-not-serializable', islandNotSerializable, {
  valid: [
    // plain JSON-ish data
    {
      filename,
      code: `
        interface Props { name: string; count: number; tags: readonly string[]; nested: { id: string } }
        function C(p: Props) { return null as any; }
        export const v = <C client:load name="x" count={1} tags={[]} nested={{ id: 'a' }} />;
      `,
    },
    // children arrive as slots, not serialized props — ignored even if non-serializable
    {
      filename,
      code: `
        interface Props { name: string; children: Date }
        function C(p: Props) { return null as any; }
        export const v = <C client:load name="x" />;
      `,
    },
    // not hydrated → not checked
    {
      filename,
      code: `
        interface Props { onClick: () => void }
        function C(p: Props) { return null as any; }
        export const v = <C onClick={() => {}} />;
      `,
    },
    // intersection of plain shapes, including one with a nested union arm, stays serializable
    {
      filename,
      code: `
        type Base = { id: string };
        type Item = Base & { name: string } & (
          | { custom: false; extra?: never }
          | { custom: true; extra: { note: string } }
        );
        interface Props { item: Item }
        function C(p: Props) { return null as any; }
        export const v = <C client:load item={{ id: 'a', name: 'x', custom: false }} />;
      `,
    },
    // a generic that expands on every level ends the walk instead of the stack
    {
      filename,
      code: `
        type Deep<T> = { v: T; next: Deep<[T]> };
        interface Props { deep: Deep<string>; }
        function C(p: Props) { return null as any; }
        export const v = <C client:load deep={null as any} />;
      `,
    },
    // the same generic under different arguments on sibling props is walked for each
    {
      filename,
      code: `
        type Box<T> = { value: T };
        interface Props { a: Box<string>; b: Box<number> }
        function C(p: Props) { return null as any; }
        export const v = <C client:load a={{ value: 'x' }} b={{ value: 1 }} />;
      `,
    },
  ],
  invalid: [
    // function prop
    {
      filename,
      code: `
        interface Props { onClick: () => void }
        function C(p: Props) { return null as any; }
        export const v = <C client:load onClick={() => {}} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'onClick'`, v: 'is' } }],
    },
    // class instance (Date)
    {
      filename,
      code: `
        interface Props { when: Date }
        function C(p: Props) { return null as any; }
        export const v = <C client:load when={new Date()} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'when'`, v: 'is' } }],
    },
    // object containing a non-serializable member is reported at the enclosing object
    {
      filename,
      code: `
        interface Props { user: { name: string; cb: () => void } }
        function C(p: Props) { return null as any; }
        export const v = <C client:load user={{ name: 'x', cb: () => {} }} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'user'`, v: 'is' } }],
    },
    // an expanding generic still reports what sits on its first level
    {
      filename,
      code: `
        type Deep<T> = { v: T; next: Deep<[T]> };
        interface Props { deep: Deep<Date>; }
        function C(p: Props) { return null as any; }
        export const v = <C client:load deep={null as any} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'deep.v'`, v: 'is' } }],
    },
    // sibling instantiations of one generic are checked separately
    {
      filename,
      code: `
        type Box<T> = { value: T };
        interface Props { a: Box<string>; b: Box<Date> }
        function C(p: Props) { return null as any; }
        export const v = <C client:load a={{ value: 'x' }} b={{ value: new Date() }} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'b.value'`, v: 'is' } }],
    },
    // a non-serializable member nested one level deeper is reported at its enclosing object
    {
      filename,
      code: `
        interface Props { outer: { inner: { cb: () => void } } }
        function C(p: Props) { return null as any; }
        export const v = <C client:load outer={{ inner: { cb: () => {} } }} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'outer.inner'`, v: 'is' } }],
    },
    // a non-serializable member contributed by one arm of an intersection is still caught
    {
      filename,
      code: `
        type Base = { id: string };
        type Item = Base & { when: Date };
        interface Props { item: Item }
        function C(p: Props) { return null as any; }
        export const v = <C client:load item={{ id: 'a', when: new Date() }} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'item.when'`, v: 'is' } }],
    },
    // a member expression tag is an island like any other
    {
      filename,
      code: `
        function C(p: { onSelect: () => void }) { return null as any; }
        const UI = { C };
        export const v = <UI.C client:load onSelect={() => {}} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'UI.C', names: `'onSelect'`, v: 'is' } }],
    },
  ],
});
