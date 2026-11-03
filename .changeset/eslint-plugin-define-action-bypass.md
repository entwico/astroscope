---
'@astroscope/eslint-plugin': major
---

`no-astro-define-action` reports `defineAction` reached through a namespace import, a dynamic `import()` or a re-export of `astro:actions`, and leaves type-only imports alone instead of rewriting them into value imports
