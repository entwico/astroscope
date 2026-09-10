# @astroscope/eslint-plugin

Additional ESLint rules for Astro projects. Plays well with `eslint-plugin-astro`.

## Installation

```bash
npm install -D @astroscope/eslint-plugin
```

## Setup

```js
// eslint.config.js
import astroscope from '@astroscope/eslint-plugin';

export default [
  // ... other configs (eslint-plugin-astro, typescript-eslint, etc.)
  ...astroscope.configs.recommended,

  // opt-in for @astroscope/i18n projects
  ...astroscope.configs.i18n,

  // opt-in for @astroscope/wormhole projects
  ...astroscope.configs.wormhole,
];
```

## Rules

| Rule                                                 | Severity | Fixable | Type-aware | Description                                                                       |
| ---------------------------------------------------- | -------- | ------- | ---------- | --------------------------------------------------------------------------------- |
| `@astroscope/no-excess-jsx-props`                    | error    |         | yes        | flag excess properties passed to hydrated React islands (`client:*` elements)     |
| `@astroscope/island-readonly`                        | error    |         | yes        | require a hydrated island's props to be deeply readonly (no server-data mutation) |
| `@astroscope/island-not-serializable`                | error    |         | yes        | require a hydrated island's props to be directly serializable plain data          |
| `@astroscope/no-client-directive-on-astro-component` | error    |         |            | disallow `client:*` directives on Astro components (they only hydrate frameworks) |
| `@astroscope/no-html-comments`                       | error    | yes     |            | disallow HTML comments in `.astro` templates — they render into the output HTML   |
| `@astroscope/no-server-action-calls`                 | error    |         |            | disallow calling actions during server rendering of `.astro` files                |
| `@astroscope/prefer-ssr-guard`                       | error    | yes     |            | prefer `import.meta.env.SSR` over `typeof window !== 'undefined'` (and friends)   |

## Rule Details

### `no-excess-jsx-props`

Every property passed to a hydrated (`client:*`) component is serialized into the page HTML. Spreading a server object wider than the declared prop type ships those extras — DB rows, session tokens, internal IDs — to every visitor.

```astro
---
const user = { name: 'x', email: 'y', passwordHash: 'secret' };
---

<!-- flagged: 'passwordHash' -->
<UserCard client:load {...user} />

<!-- clean -->
<UserCard client:load name={user.name} email={user.email} />
```

Also catches excess fields inside nested objects and array elements:

```astro
---
// <ArticleList> declares only { title; excerpt } on each element
const articles = [{ id: 'a1', title: 'Hello', excerpt: '…', body: '…', authorEmail: 'x@y.com' }];
---

<!-- flagged: 'articles[].authorEmail', 'articles[].body', 'articles[].id' -->
<ArticleList client:load articles={articles} />
```

### `island-readonly`

A hydrated island is a framework component (React/Vue/Svelte/…) rendered server-side with the original props object — often a server/cache record. If the island's component body mutates a prop, it mutates that shared server object, which can poison a server cache. The fix is structural: declare the island's props deeply `readonly` so the type system forbids mutation.

```astro
---
const article = await getArticle(); // a server/cache record
---

<!-- flagged: <Reader>'s props are mutable --><!-- declared: interface Props { article: { title: string } } -->
<Reader client:load article={article} />

<!-- clean -->
<!-- declared: interface Props { readonly article: { readonly title: string } } -->
<Reader client:load article={article} />
```

Pairs with `react/prefer-read-only-props` from `eslint-plugin-react` (shallow, auto-fixable): that enforces the top level on every React component; this enforces deep readonly specifically on island props.

### `island-not-serializable`

Props passed to a hydrated island are serialized into the page HTML and rehydrated in the browser. Only plain data survives that round-trip — primitives, plain objects, and arrays. Functions, symbols, bigints, and class instances (`Date`, `URL`, `RegExp`, `Map`, …) do not. The `children` prop is ignored: children arrive as slots, not serialized props.

```astro
<!-- flagged: 'onSelect' (function), 'createdAt' (Date) --><!-- declared: interface Props { onSelect: () => void; createdAt: Date } -->
<Widget client:load onSelect={fn} createdAt={new Date()} />

<!-- clean -->
<!-- declared: interface Props { selectedId: string; createdAt: string } -->
<Widget client:load selectedId="a1" createdAt={now.toISOString()} />
```

### `no-client-directive-on-astro-component`

`client:*` directives hydrate framework components. On an Astro component (imported from a `.astro` file) they do nothing — a sign the markup was meant for a framework island or the directive is dead.

```astro
---
import Card from './Card.astro';
import Counter from './Counter.tsx';
---

<!-- flagged: client:visible has no effect on an Astro component -->
<Card client:visible />

<!-- clean -->
<Counter client:visible />
```

### `no-html-comments`

HTML comments (`<!-- -->`) in `.astro` templates render into the served HTML and are visible to clients. JSX-style comments (`{/* */}`) are stripped at compile time and never reach the browser.

```astro
<!-- flagged --><!-- debug: session={session} --><!-- clean -->{/* debug: session={session} */}
```

Autofix rewrites `<!-- x -->` → `{/* x */}`. Declines to autofix when the comment body contains `*/` (would terminate the JSX comment early).

### `no-server-action-calls`

Astro frontmatter and template expressions run during server rendering — a plain GET page render. Calling an action there fires the mutation on every render, outside the action endpoint's POST-only + origin-checked delivery, and couples the page to the controller. A direct `actions.<name>()` call also throws `ActionCalledFromServerError` at runtime; `Astro.callAction()` is Astro's escape hatch around that error and is flagged the same. When an action and astro code need the same logic, put it in its own module and import it from both.

Non-call references stay legal — passing `actions.<name>` to a form or to `Astro.getActionResult()` is the intended server-side usage, and client `<script>` blocks are unaffected.

```astro
---
import { actions } from 'astro:actions';

// flagged
const result = await actions.like({ id: postId });
const result2 = await Astro.callAction(actions.like, { id: postId });

// clean — read the submitted result
const submitted = Astro.getActionResult(actions.like);
---

<!-- clean — the intended usage -->
<form method="POST" action={actions.like}></form>
```

### `prefer-ssr-guard`

Unlike `typeof window !== 'undefined'`, `import.meta.env.SSR` lets the bundler tree-shake the browser-only code out of the SSR build.

```ts
// flagged
if (typeof window !== 'undefined') {
  const { default: HLS } = await import('hls.js'); // shipped to SSR bundle
  player.attach(HLS);
}

// clean — `import('hls.js')` never appears in the SSR bundle
if (!import.meta.env.SSR) {
  const { default: HLS } = await import('hls.js');
  player.attach(HLS);
}
```

## i18n Rules (`configs.i18n`)

Rules for projects using `@astroscope/i18n`, opt-in alongside `recommended`. They keep their own plugin namespace, so rule ids read `@astroscope/i18n/...`.

| Rule | Severity | Fixable | Description |
|------|----------|---------|-------------|
| `@astroscope/i18n/t-import-source` | error | | `t` must be imported from `@astroscope/i18n/translate` |
| `@astroscope/i18n/no-module-level-t` | error | | `t()` must not be called at module level (needs request context on server, hydrated translations on client) |
| `@astroscope/i18n/t-static-key` | error | | first argument must be a static string literal (dynamic keys break build-time extraction) |
| `@astroscope/i18n/t-static-meta` | warn | | second argument must be statically analyzable (extraction reads it at build time) |
| `@astroscope/i18n/t-requires-meta` | warn | | second argument (fallback/meta) should be provided for development DX |
| `@astroscope/i18n/no-t-reassign` | error | | forbids aliasing or reassigning `t` (the extractor only recognizes `t()` calls) |
| `@astroscope/i18n/no-raw-strings-in-jsx` | warn | | warns when raw strings appear in JSX that may need translation |

## i18n Rule Details

### `t-import-source`

Ensures `t` is only imported from the correct `@astroscope/i18n` entrypoints.

```ts
// good
import { t } from '@astroscope/i18n/translate';

// bad
import { t } from 'i18next';
import { t } from './my-translate';
```

### `no-module-level-t`

Forbids calling `t()` at module scope. On the server, `t()` reads from `AsyncLocalStorage` (request context). On the client, it reads from `window.__i18n__`. Neither is available during module evaluation.

```ts
// good
function render() {
  return t('key', 'fallback');
}

// bad
const title = t('key', 'fallback');
```

### `t-static-key`

The first argument must be a string literal. Dynamic keys cannot be extracted at build time by the Babel plugin.

```ts
// good
t('checkout.title', 'Checkout');

// bad
t(key, 'fallback');
t('prefix.' + suffix, 'fallback');
t(`prefix.${suffix}`, 'fallback');
```

### `t-requires-meta`

The second argument (fallback string or meta object) provides the fallback text shown during development when translations are missing.

```ts
// good
t('key', 'Hello World');
t('key', { fallback: 'Hello World', description: 'Greeting' });

// bad (no fallback — shows raw key in dev)
t('key');
```

### `no-t-reassign`

The build-time extractor only recognizes `t()` calls by name. Aliasing or reassigning breaks extraction.

```ts
// good
import { t } from '@astroscope/i18n/translate';

// bad
import { t as translate } from '@astroscope/i18n/translate';
const translate = t;
```

### `no-raw-strings-in-jsx`

Warns when JSX contains raw string literals that may need translation. Ignores whitespace, numbers, and common non-translatable attributes (`className`, `href`, `type`, etc.).

```tsx
// warns
<div>Hello World</div>
<button>Submit</button>

// no warning
<div className="container" />
<div>{t('greeting', 'Hello World')}</div>
```

#### Options

```js
'@astroscope/i18n/no-raw-strings-in-jsx': ['warn', {
  // additional regex patterns to ignore (applied to text content)
  ignorePatterns: ['^TODO'],
  // additional attribute names to ignore
  ignoreAttributes: ['data-tooltip'],
}]
```

The default ignore list is exported as `DEFAULT_IGNORE_ATTRIBUTES` for consumers who want to extend it:

```js
import astroscope, { DEFAULT_IGNORE_ATTRIBUTES } from '@astroscope/eslint-plugin';

// ...
'@astroscope/i18n/no-raw-strings-in-jsx': ['warn', {
  ignoreAttributes: [...DEFAULT_IGNORE_ATTRIBUTES, 'alt', 'data-tooltip'],
}]
```

## Wormhole Rules (`configs.wormhole`)

Rules for projects using `@astroscope/wormhole`, opt-in alongside `recommended`. They keep their own plugin namespace, so rule ids read `@astroscope/wormhole/...`.

| Rule | Severity | Fixable | Description |
|------|----------|---------|-------------|
| `@astroscope/wormhole/wormholes-static-access` | warn | | accesses on the `wormholes` proxy must be static — dynamic keys and aliasing defeat build-time payload slicing |
| `@astroscope/wormhole/server-readonly` | error | | `set()` / `subscribe()` are client-only; astro files are server code where values are request-scoped |
| `@astroscope/wormhole/no-use-wormhole-in-astro` | error | | the `useWormhole` react hook cannot run in astro server code — use `wormholes.<name>.get()` |
| `@astroscope/wormhole/no-registry-import` | error | | the wormhole registry (`src/wormholes.ts`) is server-only — island code reads through the `wormholes` proxy |

## Wormhole Rule Details

### `wormholes-static-access`

The build-time scanner resolves `wormholes.<name>` accesses to decide which wormholes each chunk needs. Anything it cannot resolve degrades the chunk to "all open wormholes" — sound, but it defeats slicing. Astro files are exempt (server-rendered, never in the client chunk graph).

```ts
// good
wormholes.cart.get();
wormholes['session'].subscribe(fn);

// bad
wormholes[name].get();
const w = wormholes;
const { cart } = wormholes;
```

### `server-readonly`

Astro frontmatter and template expressions run on the server, where wormhole values are request-scoped and read-only: `set()` throws at runtime and `subscribe()` never fires. Client `<script>` blocks are unaffected.

```astro
---
const cart = wormholes.cart.get(); // good

wormholes.cart.set({ items: [] }); // bad
---
```

### `no-use-wormhole-in-astro`

`useWormhole` is a React hook — there is no React runtime in astro server code.

```astro
---
// bad
import { useWormhole } from '@astroscope/wormhole/react';

// good: read directly
import { wormholes } from '@astroscope/wormhole';

const cart = wormholes.cart.get();
---
```

### `no-registry-import`

The registry carries the handlers, and with them server code — a client build that includes it fails. Island code (`.tsx`/`.jsx`) reads through the proxy; type imports of the registry module are fine.

```tsx
// bad
import { wormholes } from '@/wormholes';

// good
import { wormholes } from '@astroscope/wormhole';
import type { Cart } from '@/wormholes';
```

## Compatibility

- ESLint 9 and 10
- Works alongside `eslint-plugin-astro` (order-independent), or standalone

## License

MIT
