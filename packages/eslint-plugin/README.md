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
| `@astroscope/no-frontmatter-only-page`               | error    |         |            | disallow `.astro` pages with frontmatter but no template — write a `.ts` endpoint |
| `@astroscope/no-server-action-calls`                 | error    |         |            | disallow calling actions during server rendering of `.astro` files                |
| `@astroscope/prefer-ssr-guard`                       | error    | yes     |            | prefer `import.meta.env.SSR` over `typeof window !== 'undefined'` (and friends)   |
| `@astroscope/no-astro-define-action`                 | error    | yes     |            | require the platform `defineAction` (with guards) instead of the `astro:actions` one |

## Rule Details

### `no-excess-jsx-props`

Flags properties passed to a hydrated (`client:*`) component that its declared prop type does not have, including inside nested objects and array elements.

```astro
---
const user = { name: 'x', email: 'y', passwordHash: 'secret' };
---

<!-- flagged: 'passwordHash' -->
<UserCard client:load {...user} />

<!-- clean -->
<UserCard client:load name={user.name} email={user.email} />
```

### `island-readonly`

Declare a hydrated island's props deeply `readonly`.

```astro
---
const article = await getArticle(); // a server/cache record
---

<!-- flagged: <Reader>'s props are mutable -->
<!-- declared: interface Props { article: { title: string } } -->
<Reader client:load article={article} />

<!-- clean -->
<!-- declared: interface Props { readonly article: { readonly title: string } } -->
<Reader client:load article={article} />
```

Pairs with `react/prefer-read-only-props` from `eslint-plugin-react` (shallow, auto-fixable): that enforces the top level on every React component; this enforces deep readonly specifically on island props.

### `island-not-serializable`

Props of a hydrated island must be plain data — primitives, plain objects, and arrays. Functions, symbols, bigints, and class instances (`Date`, `URL`, `RegExp`, `Map`, …) are flagged. The `children` prop is ignored.

```astro
<!-- flagged: 'onSelect' (function), 'createdAt' (Date) -->
<!-- declared: interface Props { onSelect: () => void; createdAt: Date } -->
<Widget client:load onSelect={fn} createdAt={new Date()} />

<!-- clean -->
<!-- declared: interface Props { selectedId: string; createdAt: string } -->
<Widget client:load selectedId="a1" createdAt={now.toISOString()} />
```

### `no-client-directive-on-astro-component`

`client:*` directives hydrate framework components; on an Astro component (imported from a `.astro` file) they do nothing.

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

Use JSX-style comments (`{/* */}`) instead of HTML comments (`<!-- -->`) in `.astro` templates.

```astro
<!-- flagged -->
<!-- debug: session={session} -->
<!-- clean -->
{/* debug: session={session} */}
```

Autofix rewrites `<!-- x -->` → `{/* x */}`, except when the comment body contains `*/`.

### `no-frontmatter-only-page`

An `.astro` file under `pages/` with frontmatter and no template belongs in a `.ts` endpoint.

```astro
---
// flagged: src/pages/onboarding/index.astro
const { denied, account } = await guard(Astro, [onboarding]);

if (denied) return denied;

return Astro.redirect(await getOnboardingResumeRoute(account.id), 302);
---
```

```ts
// clean: src/pages/onboarding/index.ts
export const GET = defineRoute({
  guards: [onboarding],
  handler: async ({ locals, redirect }) => redirect(await getOnboardingResumeRoute(locals.account.id), 302),
});
```

### `no-astro-define-action`

Import `defineAction` from `@astroscope/node/guards` (see [guards](../node/README.md#guards)), not from `astro:actions`. The other `astro:actions` exports (`ActionError`, `getActionContext`, `actions`) stay legal, and so do type-only imports. The fix rewrites the named import.

```ts
// flagged
import { defineAction } from 'astro:actions';
import * as astroActions from 'astro:actions';
export const like = astroActions.defineAction({ handler });
export { defineAction } from 'astro:actions';

// clean
import { defineAction } from '@astroscope/node/guards';
import { ActionError } from 'astro:actions';
import type { defineAction as DefineAction } from 'astro:actions';
```

Option `source` (default `@astroscope/node/guards`) names the module the fix imports from, for a project wrapping the platform's `defineAction` once more.

### `no-server-action-calls`

Do not call actions (`actions.<name>()`, `Astro.callAction()`) from astro frontmatter or template expressions. Logic an action and astro code share goes into its own module, imported from both.

Non-call references stay legal: passing `actions.<name>` to a form or to `Astro.getActionResult()` is the intended usage, and client `<script>` blocks are unaffected.

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

Use `import.meta.env.SSR` instead of `typeof window !== 'undefined'` and similar checks. In a file plain node runs (configs, scripts) `import.meta.env` is `undefined`: turn the rule off there.

Option `globals` (default `['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'self']`) names the globals whose `typeof` checks are reported.

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

| Rule                                     | Severity | Fixable | Description                                                                                                 |
| ---------------------------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `@astroscope/i18n/t-import-source`       | error    |         | `t` must be imported from `@astroscope/i18n/translate`                                                      |
| `@astroscope/i18n/no-module-level-t`     | error    |         | `t()` / `rich()` must not be called at module level |
| `@astroscope/i18n/t-static-key`          | error    |         | first argument must be a static string literal                                                              |
| `@astroscope/i18n/t-static-meta`         | warn     |         | second argument must be statically analyzable: no concatenation, interpolation or tagged templates |
| `@astroscope/i18n/t-requires-meta`       | warn     |         | second argument (fallback/meta) should be provided for development DX                                       |
| `@astroscope/i18n/t-valid-message`       | error    |         | the fallback must be a valid MessageFormat 2 message using known functions                                  |
| `@astroscope/i18n/t-message-values`      | error    |         | the values passed must match the variables of the fallback message                                          |
| `@astroscope/i18n/rich-message-components` | error  |         | the components passed to `rich()` must match the markup tags of the fallback message                        |
| `@astroscope/i18n/no-t-reassign`         | error    |         | forbids aliasing or reassigning `t`                                                                         |
| `@astroscope/i18n/no-raw-strings-in-jsx` | warn     |         | warns when raw strings appear in JSX that may need translation                                              |

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

Forbids calling `t()` or `rich()` at module scope.

```ts
// good
function render() {
  return t('key', 'fallback');
}

// bad
const title = t('key', 'fallback');
```

### `t-static-key`

The first argument of `t()` and `rich()` must be a string literal.

```ts
// good
t('checkout.title', 'Checkout');

// bad
t(key, 'fallback');
t('prefix.' + suffix, 'fallback');
t(`prefix.${suffix}`, 'fallback');
```

### `t-requires-meta`

The second argument of `t()` and `rich()` (fallback string or meta object) provides the fallback text shown during development when translations are missing.

```ts
// good
t('key', 'Hello World');
t('key', { fallback: 'Hello World', description: 'Greeting' });

// bad (no fallback — shows raw key in dev)
t('key');
```

### `no-t-reassign`

Forbids aliasing or reassigning `t`.

```ts
// good
import { t } from '@astroscope/i18n/translate';

// bad
import { t as translate } from '@astroscope/i18n/translate';
const translate = t;
```

### `t-valid-message`

Parses the fallback as MessageFormat 2 and reports syntax errors, selectors without an annotation or a catch-all variant, and functions `@astroscope/i18n` does not know.

```ts
// good
t('count', '{$count :number} items', { count });

// bad
t('count', '{$count :number items', { count }); // unclosed placeholder
t('count', '{$count :nubmer} items', { count }); // unknown function
```

### `t-message-values`

Compares the variables of the fallback message with the values passed to `t()` (third argument) or `rich()` (fourth argument), and with the `variables` meta. Values that are not an inline object literal are checked through their TypeScript type when the file is linted with type information.

```ts
// good
t('greeting', 'Hello {$name}', { name });

// bad
t('greeting', 'Hello {$name}'); // no `name` value
t('greeting', 'Hello', { name }); // `name` is not used
t('greeting', 'Hello {name}', { name }); // `{name}` is literal text, the variable is `{$name}`
t('greeting', { fallback: 'Hello {$name}', variables: { user: { description: '…' } } }, { name }); // stale meta
```

### `rich-message-components`

Compares the markup tags of the fallback message with the components passed to `rich()`, with the same handling of components that are not an inline object literal. Also reports tags that are not opened and closed in pairs.

```tsx
// good
rich('tos', 'Read our {#link}Terms{/link}', { link: (children) => <a href="/tos">{children}</a> });

// bad
rich('tos', 'Read our {#link}Terms{/link}', {}); // no `link` component
rich('tos', 'Read our Terms', { link: (children) => <a href="/tos">{children}</a> }); // `link` is not used
rich('tos', 'Read our {#link}Terms', { link }); // never closed
```

### `no-raw-strings-in-jsx`

Warns when JSX contains raw string literals that may need translation. Text matching `DEFAULT_IGNORE_PATTERNS` and attributes in `DEFAULT_IGNORE_ATTRIBUTES` are ignored.

```tsx
// warns
<div>Hello World</div>
<button>Submit</button>

<button aria-label="Close dialog" />

// no warning
<div className="container" />
<div aria-modal="true" />
<div>{t('greeting', 'Hello World')}</div>
```

#### Options

```js
'@astroscope/i18n/no-raw-strings-in-jsx': ['warn', {
  // additional regex patterns to ignore (applied to text content), on top of the built-in ones
  ignorePatterns: ['^TODO'],
  // attribute names to ignore, replacing the built-in list
  ignoreAttributes: ['data-tooltip'],
}]
```

`ignorePatterns` adds to the built-in patterns (exported as `DEFAULT_IGNORE_PATTERNS`). `ignoreAttributes` replaces the built-in list, exported as `DEFAULT_IGNORE_ATTRIBUTES` for consumers who want to extend it:

```js
import astroscope, { DEFAULT_IGNORE_ATTRIBUTES } from '@astroscope/eslint-plugin';

// ...
'@astroscope/i18n/no-raw-strings-in-jsx': ['warn', {
  ignoreAttributes: [...DEFAULT_IGNORE_ATTRIBUTES, 'alt', 'data-tooltip'],
}]
```

## Wormhole Rules (`configs.wormhole`)

Rules for projects using `@astroscope/wormhole`, opt-in alongside `recommended`. They keep their own plugin namespace, so rule ids read `@astroscope/wormhole/...`.

| Rule                                            | Severity | Fixable | Description                                                                                                    |
| ----------------------------------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `@astroscope/wormhole/wormholes-static-access`  | warn     |         | accesses on the `wormholes` proxy must be static                                                               |
| `@astroscope/wormhole/server-readonly`          | error    |         | `set()` / `subscribe()` are client-only, not for astro files                                                   |
| `@astroscope/wormhole/no-use-wormhole-in-astro` | error    |         | no `useWormhole` in astro files — use `wormholes.<name>.get()`                                                 |
| `@astroscope/wormhole/no-registry-import`       | error    |         | island code reads through the `wormholes` proxy, never the registry (`src/wormholes.ts`)                      |

## Wormhole Rule Details

### `wormholes-static-access`

Access wormholes statically (`wormholes.<name>`). Astro files are exempt.

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

Astro frontmatter and template expressions read wormholes with `get()` only. Client `<script>` blocks are unaffected.

```astro
---
const cart = wormholes.cart.get(); // good

wormholes.cart.set({ items: [] }); // bad
---
```

### `no-use-wormhole-in-astro`

Astro code reads wormholes directly instead of through the `useWormhole` hook.

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

Island code (`.tsx`/`.jsx`) reads through the proxy; type imports of the registry module are fine.

```tsx
// bad
import { wormholes } from '@/wormholes';
import '@/wormholes';
export { wormholes } from '@/wormholes';
const registry = await import('@/wormholes');

// good
import { wormholes } from '@astroscope/wormhole';
import type { Cart } from '@/wormholes';
```

## Compatibility

- ESLint 9 and 10
- Works alongside `eslint-plugin-astro` (order-independent), or standalone

## License

MIT
