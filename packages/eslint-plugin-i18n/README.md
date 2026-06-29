# @astroscope/eslint-plugin-i18n

> **Note:** This package is in active development. APIs may change between versions.

ESLint rules for projects using `@astroscope/i18n`. Enforces correct `t()` usage, catches build-time extraction issues, and steers hydration to the i18n-aware directives.

## Installation

```bash
npm install -D @astroscope/eslint-plugin-i18n
```

## Setup

```js
// eslint.config.js
import i18n from '@astroscope/eslint-plugin-i18n';

export default [
  i18n.configs.recommended,
];
```

## Rules

| Rule | Severity | Fixable | Description |
|------|----------|---------|-------------|
| `@astroscope/i18n/t-import-source` | error | | `t` must be imported from `@astroscope/i18n/translate` |
| `@astroscope/i18n/no-module-level-t` | error | | `t()` must not be called at module level (needs request context on server, hydrated translations on client) |
| `@astroscope/i18n/t-static-key` | error | | first argument must be a static string literal (dynamic keys break build-time extraction) |
| `@astroscope/i18n/t-requires-meta` | warn | | second argument (fallback/meta) should be provided for development DX |
| `@astroscope/i18n/no-t-reassign` | error | | forbids aliasing or reassigning `t` (the extractor only recognizes `t()` calls) |
| `@astroscope/i18n/prefer-x-directives` | error | yes | prefer `client:load-x` over `client:load` (and `visible`, `idle`, `media`, `only`) for i18n-aware hydration |
| `@astroscope/i18n/no-raw-strings-in-jsx` | warn | | warns when raw strings appear in JSX that may need translation |

## Rule Details

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

### `prefer-x-directives`

The `-x` client directives preload translations before hydration. They are a strict superset of the standard directives — components without translations work identically.

```astro
<!-- good -->
<Cart client:load-x />
<Cart client:visible-x />

<!-- bad -->
<Cart client:load />
<Cart client:visible />
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
import i18n, { DEFAULT_IGNORE_ATTRIBUTES } from '@astroscope/eslint-plugin-i18n';

// ...
'@astroscope/i18n/no-raw-strings-in-jsx': ['warn', {
  ignoreAttributes: [...DEFAULT_IGNORE_ATTRIBUTES, 'alt', 'data-tooltip'],
}]
```

## Compatibility

- ESLint 9 and 10
- Works with `eslint-plugin-astro` for `.astro` file support

## License

MIT
