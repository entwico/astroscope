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
    // tuples are plain arrays, template-literal and mapped strings are strings, void is an absent value
    {
      filename,
      code: `
        interface Props {
          pair: [string, number];
          fixed: readonly [number, number];
          rows: { range: [number, number] }[];
          id: \`id-\${string}\`;
          code: Uppercase<string>;
          note: string | void;
        }
        function C(p: Props) { return null as any; }
        export const v = <C client:load {...(null as any)} />;
      `,
    },
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
    // a type that says nothing about the value cannot be decided
    {
      filename,
      code: `
        interface Props { a: any; b: unknown; c: never }
        function C(p: Props) { return null as any; }
        export const v = <C client:load a={1} b={2} c={null as never} />;
      `,
    },
    // neither can an unconstrained type parameter
    {
      filename,
      code: `
        function C<T>(p: { value: T }) { return null as any; }
        export const v = <C client:load value="x" />;
      `,
    },
    // a type parameter is judged by its constraint
    {
      filename,
      code: `
        function C<T extends { id: string }>(p: { value: T }) { return null as any; }
        export const v = <C client:load value={{ id: 'a' }} />;
      `,
    },
    // a component that takes no props has nothing to serialize
    {
      filename,
      code: `
        function C() { return null as any; }
        export const v = <C client:load />;
      `,
    },
  ],
  invalid: [
    // a tuple is judged by its elements
    {
      filename,
      code: `
        interface Props { pair: [string, Date] }
        function C(p: Props) { return null as any; }
        export const v = <C client:load {...(null as any)} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'pair[]'`, v: 'is' } }],
    },
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
    // primitives json has no representation for, listed together
    {
      filename,
      code: `
        interface Props { big: bigint; sym: symbol; n: number }
        function C(p: Props) { return null as any; }
        export const v = <C client:load big={1n} sym={Symbol()} n={1} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'big', 'sym'`, v: 'are' } }],
    },
    // the values of an index signature are checked like array elements
    {
      filename,
      code: `
        interface Props { byId: Record<string, Date> }
        function C(p: Props) { return null as any; }
        export const v = <C client:load byId={{}} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'byId[]'`, v: 'is' } }],
    },
    // a type parameter constrained to a non-serializable type is reported through its constraint
    {
      filename,
      code: `
        function C<T extends () => void>(p: { cb: T }) { return null as any; }
        export const v = <C client:load cb={() => {}} />;
      `,
      errors: [{ messageId: 'notSerializable', data: { comp: 'C', names: `'cb'`, v: 'is' } }],
    },
  ],
});

// without type information (a file outside the typed project) the rule stays silent instead of failing the lint run
new RuleTester().run('island-not-serializable without type information', islandNotSerializable, {
  valid: [
    {
      filename,
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      code: `
        interface Props { onClick: () => void }
        function C(p: Props) { return null as any; }
        export const v = <C client:load onClick={() => {}} />;
      `,
    },
  ],
  invalid: [],
});
