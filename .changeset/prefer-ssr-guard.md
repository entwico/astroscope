---
'@astroscope/eslint-plugin': minor
---

add `prefer-ssr-guard` rule — flags `typeof window !== 'undefined'` (and friends) and rewrites to `import.meta.env.SSR` so Vite can tree-shake the dead branch from the SSR bundle
