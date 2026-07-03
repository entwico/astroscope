import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

import { noExcessJsxProps } from './no-excess-jsx-props.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tsconfigRootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures');

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: {
        allowDefaultProject: ['*.tsx', '*.ts'],
      },
      tsconfigRootDir,
    },
  },
});

const filename = 'test.tsx';

// shorthand error matchers — avoid repeating the five placeholder keys everywhere
const err = (comp: string, names: string[]) => ({
  messageId: 'excessProps' as const,
  data: {
    s: names.length > 1 ? 'ies' : 'y',
    v: names.length > 1 ? '' : 's',
    them: names.length > 1 ? 'them' : 'it',
    names: names.map((n) => `'${n}'`).join(', '),
    comp,
  },
});

tester.run('no-excess-jsx-props', noExcessJsxProps, {
  valid: [
    // explicit named primitives — never triggers
    {
      filename,
      code: `
        interface Props { name: string; email: string; }
        function C(p: Props) { return null as any; }
        const user = { name: 'x', email: 'y' };
        export const v = <C client:load name={user.name} email={user.email} />;
      `,
    },
    // spread of a narrower object literal
    {
      filename,
      code: `
        interface Props { name: string; email: string; }
        function C(p: Props) { return null as any; }
        export const v = <C client:load {...{ name: 'x', email: 'y' }} />;
      `,
    },
    // spread of exactly-typed variable
    {
      filename,
      code: `
        interface Props { name: string; email: string; }
        function C(p: Props) { return null as any; }
        const user: Props = { name: 'x', email: 'y' };
        export const v = <C client:load {...user} />;
      `,
    },
    // intrinsic (lowercase) elements are not checked
    {
      filename,
      code: `
        const attrs = { onClick: () => {}, somethingExtra: 1 };
        export const v = <div {...attrs} />;
      `,
    },
    // any-typed source → skip (can't decide)
    {
      filename,
      code: `
        interface Props { name: string; }
        function C(p: Props) { return null as any; }
        const dynamic: any = {};
        export const v = <C client:load {...dynamic} />;
      `,
    },
    // index signature on source → skip (can't decide)
    {
      filename,
      code: `
        interface Props { name: string; }
        function C(p: Props) { return null as any; }
        const bag: Record<string, unknown> = {};
        export const v = <C client:load {...bag} />;
      `,
    },
    // index signature on props → allow all
    {
      filename,
      code: `
        interface Props { [k: string]: unknown }
        function C(p: Props) { return null as any; }
        const user = { a: 1, b: 2, c: 3 };
        export const v = <C client:load {...user} />;
      `,
    },
    // component has no call signature → skip
    {
      filename,
      code: `
        const NotAComponent = { foo: 1 };
        const x = { extra: 1 };
        export const v = <NotAComponent client:load {...x} />;
      `,
    },
    // named object-valued attribute, shapes match
    {
      filename,
      code: `
        interface Address { street: string; city: string; }
        interface Props { billing: Address; }
        function C(p: Props) { return null as any; }
        const billing: Address = { street: 'Main 1', city: 'Berlin' };
        export const v = <C client:load billing={billing} />;
      `,
    },
    // array of matching shape
    {
      filename,
      code: `
        interface Item { id: number; label: string; }
        interface Props { items: Item[]; }
        function C(p: Props) { return null as any; }
        const items: Item[] = [{ id: 1, label: 'x' }];
        export const v = <C client:load items={items} />;
      `,
    },
    // recursive declared type; actual shape matches and self-references
    {
      filename,
      code: `
        interface TreeNode { value: string; children: TreeNode[]; }
        interface Props { tree: TreeNode; }
        function C(p: Props) { return null as any; }
        const leaf: TreeNode = { value: 'l', children: [] };
        const tree: TreeNode = { value: 'root', children: [leaf] };
        export const v = <C client:load tree={tree} />;
      `,
    },
    // indirect recursion A → B → A; actual matches
    {
      filename,
      code: `
        interface A { tag: 'a'; b?: B; }
        interface B { tag: 'b'; a?: A; }
        interface Props { root: A; }
        function C(p: Props) { return null as any; }
        const root: A = { tag: 'a' };
        export const v = <C client:load root={root} />;
      `,
    },
    // nested expression is any-typed — don't flag (can't decide)
    {
      filename,
      code: `
        interface Address { street: string; }
        interface Props { billing: Address; }
        function C(p: Props) { return null as any; }
        const billing: any = { street: 'x', whatever: 1 };
        export const v = <C client:load billing={billing} />;
      `,
    },
    // library-typed prop passed an instance of that type — identity short-circuit
    {
      filename,
      code: `
        interface Props { tags: Set<string>; }
        function C(p: Props) { return null as any; }
        const tags = new Set<string>();
        export const v = <C client:load tags={tags} />;
      `,
    },
    // intersection types → merged allowed keys
    {
      filename,
      code: `
        type Base = { id: string };
        type Extra = { label: string };
        interface Props { item: Base & Extra; }
        function C(p: Props) { return null as any; }
        const item: Base & Extra = { id: 'x', label: 'y' };
        export const v = <C client:load item={item} />;
      `,
    },
    // interface inheritance → merged allowed keys
    {
      filename,
      code: `
        interface Base { id: string }
        interface Item extends Base { label: string }
        interface Props { item: Item; }
        function C(p: Props) { return null as any; }
        const item: Item = { id: 'x', label: 'y' };
        export const v = <C client:load item={item} />;
      `,
    },
    // union of primitives → treated as primitive leaf (no recurse)
    {
      filename,
      code: `
        interface Props { status: 'active' | 'inactive'; }
        function C(p: Props) { return null as any; }
        export const v = <C client:load status="active" />;
      `,
    },
    // callback prop (function type) — actual is a function → isOpaque on actual skips
    {
      filename,
      code: `
        interface Props { onClick: (e: { x: number }) => void; }
        function C(p: Props) { return null as any; }
        const handler = (e: { x: number; extra: string }) => {};
        export const v = <C client:load onClick={handler} />;
      `,
    },
    // primitive array — no object-shape excess possible
    {
      filename,
      code: `
        interface Props { tags: string[]; }
        function C(p: Props) { return null as any; }
        const tags = ['a', 'b'];
        export const v = <C client:load tags={tags} />;
      `,
    },
    // optional prop omitted → not an excess (omission is never flagged)
    {
      filename,
      code: `
        interface Props { name: string; description?: string }
        function C(p: Props) { return null as any; }
        const u = { name: 'x' };
        export const v = <C client:load {...u} />;
      `,
    },
    // T | undefined still compares against T's shape
    {
      filename,
      code: `
        interface Inner { a: string }
        interface Props { inner: Inner | undefined }
        function C(p: Props) { return null as any; }
        const inner: Inner | undefined = { a: 'x' };
        export const v = <C client:load inner={inner} />;
      `,
    },
    // generic component — unconstrained T falls back (actual is opaque wrt declared)
    {
      filename,
      code: `
        interface Props<T> { items: T[]; label: string }
        function C<T>(p: Props<T>) { return null as any; }
        const u: Props<{ id: string }> = { items: [{ id: 'x' }], label: 'y' };
        export const v = <C client:load {...u} />;
      `,
    },
    // generic component with constraint — actual matches constraint shape
    {
      filename,
      code: `
        interface HasId { id: string }
        interface Props<T extends HasId> { items: T[]; title: string }
        function C<T extends HasId>(p: Props<T>) { return null as any; }
        const u: Props<HasId> = { items: [{ id: 'x' }], title: 't' };
        export const v = <C client:load {...u} />;
      `,
    },
    // discriminated union — actual matches one branch's shape exactly
    {
      filename,
      code: `
        type Shape = { kind: 'circle'; radius: number } | { kind: 'rect'; width: number; height: number };
        interface Props { shape: Shape; }
        function C(p: Props) { return null as any; }
        const shape: Shape = { kind: 'circle', radius: 3 };
        export const v = <C client:load shape={shape} />;
      `,
    },
    // discriminated union whose actual discriminant is itself a union of literals ('b' | 'c') —
    // must narrow to the single branch covering both before comparing the (per-branch) payload shape
    {
      filename,
      code: `
        type Shape =
          | { kind: 'a'; data: { x: string } }
          | { kind: 'b' | 'c'; data: { y: number } };
        interface Props { shape: Shape; }
        function C(p: Props) { return null as any; }
        declare const shape: { kind: 'b' | 'c'; data: { y: number } };
        export const v = <C client:load shape={shape} />;
      `,
    },
    // non-discriminated union — variant-specific keys are permissive (union-of-all-branches)
    {
      filename,
      code: `
        type Either = { a: string } | { b: number };
        interface Props { e: Either; }
        function C(p: Props) { return null as any; }
        const e = { a: 'x' };
        export const v = <C client:load e={e} />;
      `,
    },
    // TS-synthesized `prop?: never` / `prop?: undefined` placeholders are not data and must not flag
    {
      filename,
      code: `
        type Item = { type: 'image'; image: { id: string }; alt: string } | { type: 'video'; video: { id: string }; poster: { id: string }; alt: string };
        interface Props { items: Item[]; }
        function C(p: Props) { return null as any; }
        type Src = { type: 'image'; image: { id: string }; main: boolean } | { type: 'video'; video: { id: string }; poster: { id: string }; main: boolean };
        declare const src: Src[];
        const items: Item[] = src.map((x) =>
          x.type === 'image'
            ? { type: 'image', image: x.image, alt: 'a' }
            : { type: 'video', video: x.video, poster: x.poster, alt: 'a' },
        );
        export const v = <C client:load items={items} />;
      `,
    },
  ],

  invalid: [
    // classic leak: wider variable spread into narrower component
    {
      filename,
      code: `
        interface Props { name: string; email: string; }
        function C(p: Props) { return null as any; }
        const user = {
          name: 'x', email: 'y',
          passwordHash: 'secret', sessionToken: 'token', internalId: 1,
        };
        export const v = <C client:load {...user} />;
      `,
      errors: [err('C', ['internalId', 'passwordHash', 'sessionToken'])],
    },
    // single excess key → singular pluralization
    {
      filename,
      code: `
        interface Props { name: string; }
        function C(p: Props) { return null as any; }
        const user = { name: 'x', extra: 1 };
        export const v = <C client:load {...user} />;
      `,
      errors: [err('C', ['extra'])],
    },
    // multiple independent spreads each reported
    {
      filename,
      code: `
        interface Props { name: string; email: string; }
        function C(p: Props) { return null as any; }
        const a = { name: 'x', leakA: 1 };
        const b = { email: 'y', leakB: 2 };
        export const v = <C client:load {...a} {...b} />;
      `,
      errors: [err('C', ['leakA']), err('C', ['leakB'])],
    },
    // React.FC-style component (call signature via FC)
    {
      filename,
      code: `
        type FC<P> = (p: P) => null;
        interface Props { name: string; }
        const C: FC<Props> = () => null;
        const user = { name: 'x', secret: 1 };
        export const v = <C client:load {...user} />;
      `,
      errors: [err('C', ['secret'])],
    },

    // nested object passed via named attribute — excess one level deep
    {
      filename,
      code: `
        interface Address { street: string; city: string; }
        interface Props { billing: Address; }
        function C(p: Props) { return null as any; }
        const billing = { street: 'Main 1', city: 'Berlin', iban: 'DE1', bic: 'X' };
        export const v = <C client:load billing={billing} />;
      `,
      errors: [err('C', ['billing.bic', 'billing.iban'])],
    },
    // two-level nested excess
    {
      filename,
      code: `
        interface Inner { c: string; }
        interface Outer { inner: Inner; }
        interface Props { outer: Outer; }
        function C(p: Props) { return null as any; }
        const outer = { inner: { c: 'x', secret: 1 } };
        export const v = <C client:load outer={outer} />;
      `,
      errors: [err('C', ['outer.inner.secret'])],
    },

    // array of widened items — excess at element shape
    {
      filename,
      code: `
        interface Item { id: number; label: string; }
        interface Props { items: Item[]; }
        function C(p: Props) { return null as any; }
        const items = [{ id: 1, label: 'x', internalScore: 0.9 }];
        export const v = <C client:load items={items} />;
      `,
      errors: [err('C', ['items[].internalScore'])],
    },
    // array of widened items with multiple extras + a nested object
    {
      filename,
      code: `
        interface Card { endsWith: string; type: string; }
        interface Props { cards: Card[]; }
        function C(p: Props) { return null as any; }
        const cards = [
          { endsWith: '4242', type: 'Visa', fullNumber: '4111', cvv: '123' },
        ];
        export const v = <C client:load cards={cards} />;
      `,
      errors: [err('C', ['cards[].cvv', 'cards[].fullNumber'])],
    },

    // direct self-reference: TreeNode → TreeNode[], excess on child node
    {
      filename,
      code: `
        interface TreeNode { value: string; children: TreeNode[]; }
        interface Props { tree: TreeNode; }
        function C(p: Props) { return null as any; }
        const tree = {
          value: 'root',
          children: [
            { value: 'leaf', children: [], secret: 'x' },
          ],
        };
        export const v = <C client:load tree={tree} />;
      `,
      errors: [err('C', ['tree.children[].secret'])],
    },
    // indirect recursion A → B → A, excess found inside B
    {
      filename,
      code: `
        interface A { tag: 'a'; b?: B; }
        interface B { tag: 'b'; a?: A; leak?: string; }
        interface Props { root: A; }
        function C(p: Props) { return null as any; }
        const root: { tag: 'a'; b: { tag: 'b'; extraOnB: number } } = {
          tag: 'a',
          b: { tag: 'b', extraOnB: 42 },
        };
        export const v = <C client:load root={root} />;
      `,
      errors: [err('C', ['root.b.extraOnB'])],
    },
    // cyclic actual with flat declared — walk bounded by declared depth
    {
      filename,
      code: `
        interface Flat { value: string; }
        interface Props { x: Flat; }
        function C(p: Props) { return null as any; }
        type Cyclic = { value: string; self: Cyclic; extra: number };
        const seed = {} as Cyclic;
        seed.value = 'x';
        seed.self = seed;
        seed.extra = 1;
        export const v = <C client:load x={seed} />;
      `,
      errors: [err('C', ['x.extra', 'x.self'])],
    },

    // nested object with a library-typed member alongside a user-typed excess key
    {
      filename,
      code: `
        interface Node { date: Date; label: string; }
        interface Props { node: Node; }
        function C(p: Props) { return null as any; }
        const node = { date: new Date(), label: 'x', secret: 'leak' };
        export const v = <C client:load node={node} />;
      `,
      errors: [err('C', ['node.secret'])],
    },

    // intersection: excess not declared on either side
    {
      filename,
      code: `
        type Base = { id: string };
        type Extra = { label: string };
        interface Props { item: Base & Extra; }
        function C(p: Props) { return null as any; }
        const item = { id: 'x', label: 'y', secret: 'leak' };
        export const v = <C client:load item={item} />;
      `,
      errors: [err('C', ['item.secret'])],
    },
    // interface inheritance: excess not in Base or derived
    {
      filename,
      code: `
        interface Base { id: string }
        interface Item extends Base { label: string }
        interface Props { item: Item; }
        function C(p: Props) { return null as any; }
        const item = { id: 'x', label: 'y', secret: 'leak' };
        export const v = <C client:load item={item} />;
      `,
      errors: [err('C', ['item.secret'])],
    },
    // wider spread with a primitive-array field — top-level excess still flagged
    {
      filename,
      code: `
        interface Props { tags: string[]; other: string; }
        function C(p: Props) { return null as any; }
        const u = { tags: ['a'], other: 'x', leak: 1 };
        export const v = <C client:load {...u} />;
      `,
      errors: [err('C', ['leak'])],
    },
    // generic component with constraint: T resolves to a wider type, excess on items
    {
      filename,
      code: `
        interface HasId { id: string }
        interface Props<T extends HasId> { items: T[]; title: string }
        function C<T extends HasId>(p: Props<T>) { return null as any; }
        const items = [{ id: 'x', secret: 'leak' }];
        export const v = <C client:load items={items} title="t" />;
      `,
      errors: [err('C', ['items[].secret'])],
    },
    // discriminated union — actual narrows to 'circle' branch, flags foreign key from 'rect'
    {
      filename,
      code: `
        type Shape = { kind: 'circle'; radius: number } | { kind: 'rect'; width: number; height: number };
        interface Props { shape: Shape; }
        function C(p: Props) { return null as any; }
        const shape = { kind: 'circle' as const, radius: 3, width: 4 };
        export const v = <C client:load shape={shape} />;
      `,
      errors: [err('C', ['shape.width'])],
    },
    // discriminated union inside array — per-element narrowing finds cross-branch foreign key
    {
      filename,
      code: `
        type Block = { type: 'text'; value: string } | { type: 'image'; src: string };
        interface Props { blocks: Block[]; }
        function C(p: Props) { return null as any; }
        const blocks = [
          { type: 'text' as const, value: 'hi' },
          { type: 'image' as const, src: 's.png', value: 'oops' },
        ];
        export const v = <C client:load blocks={blocks} />;
      `,
      errors: [err('C', ['blocks[].value'])],
    },
    // union-of-literals discriminant narrows to the matching branch — a genuine extra is still caught
    {
      filename,
      code: `
        type Shape =
          | { kind: 'a'; data: { x: string } }
          | { kind: 'b' | 'c'; data: { y: number } };
        interface Props { shape: Shape; }
        function C(p: Props) { return null as any; }
        declare const shape: { kind: 'b' | 'c'; data: { y: number; leak: string } };
        export const v = <C client:load shape={shape} />;
      `,
      errors: [err('C', ['shape.data.leak'])],
    },
    // number-literal discriminant
    {
      filename,
      code: `
        type Variant = { v: 1; a: string } | { v: 2; b: number };
        interface Props { x: Variant; }
        function C(p: Props) { return null as any; }
        const x = { v: 1 as const, a: 'hi', b: 99 };
        export const v = <C client:load x={x} />;
      `,
      errors: [err('C', ['x.b'])],
    },
    // boolean-literal discriminant
    {
      filename,
      code: `
        type Flag = { ok: true; value: string } | { ok: false; error: string };
        interface Props { f: Flag; }
        function C(p: Props) { return null as any; }
        const f = { ok: true as const, value: 'hi', error: 'leak' };
        export const v = <C client:load f={f} />;
      `,
      errors: [err('C', ['f.error'])],
    },
    // recursive discriminated union inside array — no stack overflow, finds nested leak
    {
      filename,
      code: `
        type Node =
          | { kind: 'leaf'; label: string }
          | { kind: 'branch'; items: Node[] };
        interface Props { tree: Node[]; }
        function C(p: Props) { return null as any; }
        const tree = [
          { kind: 'branch' as const, items: [
            { kind: 'leaf' as const, label: 'x', secret: 'leak' },
          ] },
        ];
        export const v = <C client:load tree={tree} />;
      `,
      errors: [err('C', ['tree[].items[].secret'])],
    },
    // deep-nesting smoke test — 8 user-declared levels, excess at the bottom
    {
      filename,
      code: `
        interface L8 { leaf: string }
        interface L7 { x8: L8 }
        interface L6 { x7: L7 }
        interface L5 { x6: L6 }
        interface L4 { x5: L5 }
        interface L3 { x4: L4 }
        interface L2 { x3: L3 }
        interface L1 { x2: L2 }
        interface Props { x1: L1 }
        function C(p: Props) { return null as any; }
        const u = { x1: { x2: { x3: { x4: { x5: { x6: { x7: { x8: { leaf: 'x', secret: 'leak' } } } } } } } } };
        export const v = <C client:load {...u} />;
      `,
      errors: [err('C', ['x1.x2.x3.x4.x5.x6.x7.x8.secret'])],
    },
  ],
});
