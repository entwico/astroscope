---
'@astroscope/i18n': patch
---

extraction picks up `rich()` keys and optional calls (`t?.()`), and only `t()` / `rich()` imported from `@astroscope/i18n/translate`, so a local function named `t` keeps its arguments
