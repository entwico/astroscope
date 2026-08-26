---
'@astroscope/i18n': major
---

removed the `client:*-x` directive forks and `<I18nScript />` — plain `client:*` directives are covered by `@astroscope/node` island preloading, and the middleware injects the client state into html responses automatically; migrate by stripping the `-x` suffixes and deleting the `<I18nScript />` line
