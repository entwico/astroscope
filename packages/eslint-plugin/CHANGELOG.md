# @astroscope/eslint-plugin

## 3.0.0

### Major Changes

- bdbf485: `no-excess-jsx-props` checks the elements of optional array props and of tuples
- bdbf485: every package of this release is a major: the audit behind it changed behaviour applications may have relied on, so read the entries before upgrading
- bdbf485: `no-astro-define-action` reports `defineAction` reached through a namespace import, a dynamic `import()` or a re-export of `astro:actions`, and leaves type-only imports alone instead of rewriting them into value imports
- bdbf485: the island rules check components written as member expressions (`<UI.Card client:load>`)
- bdbf485: `no-raw-strings-in-jsx`: `ignorePatterns` adds to the built-in patterns (exported as `DEFAULT_IGNORE_PATTERNS`) instead of replacing them, an entry that is not a valid regular expression fails the lint run with a message naming it, and text that merely starts with a brace is no longer skipped
- bdbf485: the i18n call rules (`t-static-key`, `t-requires-meta`, `t-static-meta`, `no-module-level-t`) cover `rich()` too
- bdbf485: `no-server-action-calls`, `no-registry-import`, `server-readonly` and `no-use-wormhole-in-astro` see through namespace imports, dynamic imports, re-exports, computed members and typescript wrappers (`no-server-action-calls` also every read of `Astro.callAction`, `no-registry-import` also `.mjs`/`.cjs`/`.tsx` registry files)

### Patch Changes

- bdbf485: `island-not-serializable` no longer overflows the stack on a generic props type that expands on every level
- bdbf485: `prefer-ssr-guard` leaves `typeof` checks on a local binding named like a global alone and offers no `import.meta` fix in commonjs files

## 2.2.0

### Minor Changes

- 2f9f809: new `no-astro-define-action` rule (in `recommended`, auto-fixable): `defineAction` must come from `@astroscope/node/guards`

### Patch Changes

- 03649c2: `t-static-meta` also reports a `t()` fallback or description written as a tagged template (`String.raw`), which the i18n extractor cannot read

## 2.1.1

### Patch Changes

- bd12c3d: no-raw-strings-in-jsx: stop flagging aria-* state and relationship attributes

## 2.1.0

### Minor Changes

- b936e21: new wormhole rule `no-registry-import`: island code must not import the wormhole registry

## 2.0.0

### Major Changes

- af0a493: removed `@astroscope/i18n/prefer-x-directives` — the `client:*-x` directives it enforced no longer exist in `@astroscope/i18n`

### Minor Changes

- af0a493: new `no-server-action-calls` rule (in `recommended`): forbids calling actions — directly or via `Astro.callAction()` — during server rendering of `.astro` files
- af0a493: new opt-in `configs.wormhole` rule set for `@astroscope/wormhole` projects: `wormholes-static-access` (dynamic access/aliasing defeats payload slicing), `server-readonly` (`set`/`subscribe` in astro server code), and `no-use-wormhole-in-astro`

## 1.1.0

### Minor Changes

- 42e84ba: accept astro-eslint-parser v3

## 1.0.0

### Major Changes

- 8eda3c5: absorb `@astroscope/eslint-plugin-i18n`: the i18n rules ship as a second config set (`configs.i18n`) with unchanged rule ids (`@astroscope/i18n/...`)

## 0.4.1

### Patch Changes

- 1387287: no-excess-jsx-props no longer reports false excess props when a discriminated-union has a union-of-literals discriminant

## 0.4.0

### Minor Changes

- 12e5e65: update to ESLint 10 and astro-eslint-parser 2

### Patch Changes

- 339df48: stop island-not-serializable from flagging intersection-typed props that are plain serializable data

## 0.3.0

### Minor Changes

- 201530d: add three island-safety rules (all in the recommended config): `island-readonly` requires a hydrated island's props to be deeply readonly so it can't mutate server data, `island-not-serializable` requires island props to be directly serializable plain data, and `no-client-directive-on-astro-component` flags `client:*` directives on Astro components.

## 0.2.0

### Minor Changes

- 6f29e7d: add `prefer-ssr-guard` rule — flags `typeof window !== 'undefined'` (and friends) and rewrites to `import.meta.env.SSR` so Vite can tree-shake the dead branch from the SSR bundle

## 0.1.0

### Minor Changes

- c7590b4: init
