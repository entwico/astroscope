# @astroscope/eslint-plugin

> **Note:** This package is in active development. APIs may change between versions.

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

### `prefer-ssr-guard`

Unliker `typeof window !== 'undefined'`, `import.meta.env.SSR` tree-shakes the browser code from the server

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

## Compatibility

- ESLint 9 and 10
- Works alongside `eslint-plugin-astro` (order-independent), or standalone

## License

MIT
