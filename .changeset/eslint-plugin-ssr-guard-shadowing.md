---
'@astroscope/eslint-plugin': patch
---

`prefer-ssr-guard` leaves `typeof` checks on a local binding named like a global alone and offers no `import.meta` fix in commonjs files
