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

| Rule                              | Severity | Fixable | Type-aware | Description                                                                     |
| --------------------------------- | -------- | ------- | ---------- | ------------------------------------------------------------------------------- |
| `@astroscope/no-excess-jsx-props` | error    |         | yes        | flag excess properties passed to hydrated React islands (`client:*` elements)   |
| `@astroscope/no-html-comments`    | error    | yes     |            | disallow HTML comments in `.astro` templates — they render into the output HTML |
| `@astroscope/prefer-ssr-guard`    | error    | yes     |            | prefer `import.meta.env.SSR` over `typeof window !== 'undefined'` (and friends) |

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
