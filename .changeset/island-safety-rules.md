---
'@astroscope/eslint-plugin': minor
---

add three island-safety rules (all in the recommended config): `island-readonly` requires a hydrated island's props to be deeply readonly so it can't mutate server data, `island-not-serializable` requires island props to be directly serializable plain data, and `no-client-directive-on-astro-component` flags `client:*` directives on Astro components.
