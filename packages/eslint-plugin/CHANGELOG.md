# @astroscope/eslint-plugin

## 0.2.0

### Minor Changes

- 6f29e7d: add `prefer-ssr-guard` rule — flags `typeof window !== 'undefined'` (and friends) and rewrites to `import.meta.env.SSR` so Vite can tree-shake the dead branch from the SSR bundle

## 0.1.0

### Minor Changes

- c7590b4: init
