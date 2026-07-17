# @astroscope/eslint-plugin

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
