---
'@astroscope/eslint-plugin': major
---

`no-server-action-calls`, `no-registry-import`, `server-readonly` and `no-use-wormhole-in-astro` see through namespace imports, dynamic imports, re-exports, computed members and typescript wrappers (`no-server-action-calls` also every read of `Astro.callAction`, `no-registry-import` also `.mjs`/`.cjs`/`.tsx` registry files)
