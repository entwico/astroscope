# @astroscope/eslint-plugin

## 0.3.0

### Minor Changes

- 201530d: add three island-safety rules (all in the recommended config): `island-readonly` requires a hydrated island's props to be deeply readonly so it can't mutate server data, `island-not-serializable` requires island props to be directly serializable plain data, and `no-client-directive-on-astro-component` flags `client:*` directives on Astro components.

## 0.2.0

### Minor Changes

- 6f29e7d: add `prefer-ssr-guard` rule — flags `typeof window !== 'undefined'` (and friends) and rewrites to `import.meta.env.SSR` so Vite can tree-shake the dead branch from the SSR bundle

## 0.1.0

### Minor Changes

- c7590b4: init
