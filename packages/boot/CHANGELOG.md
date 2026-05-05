# @astroscope/boot

## 0.7.1

### Patch Changes

- 389b680: show a holding page during dev-server restarts

## 0.7.0

### Minor Changes

- fe9cd9f: warmup is enabled by default and uses better routes and middleware chunk matching
- 9d91369: rename `hmr` option to `watch`; boot file changes now trigger a full dev-server restart instead of an in-process rerun

## 0.6.10

### Patch Changes

- 3b55ab9: correctly chain multiple reruns

## 0.6.9

### Patch Changes

- a0957a3: show a readable error message in the startup-failure 503 response
- d8ab642: avoid double-shutdowns
- ebcea5e: rerun hooks when a boot dependency is replaced via rm + rewrite

## 0.6.8

### Patch Changes

- 1a8f685: hold requests when an HMR rerun fails instead of serving them with uninitialized state

## 0.6.7

### Patch Changes

- a47a328: update deps

## 0.6.6

### Patch Changes

- c46ffba: fix when connected as linked package
- 083c2dd: shutdown the dev server if the initial startup fails

## 0.6.5

### Patch Changes

- af5b6d5: update license

## 0.6.4

### Patch Changes

- 317dd30: re-run boot hooks on Vite SSR full-reload

## 0.6.3

### Patch Changes

- 5a1367f: reboot on vite program reload as well

## 0.6.2

### Patch Changes

- remove named boot export

## 0.6.1

### Patch Changes

- fix warmup stripping css modules

## 0.6.0

### Minor Changes

- 903296a: remove user-defined warmup, extend warmup logic

## 0.5.0

### Minor Changes

- bbbf4fa: add warmup option on the integration level

## 0.4.0

### Minor Changes

- ad74a23: add astro@6 support

## 0.3.4

### Patch Changes

- 78112ef: astro check does not trigger boot anymore, #29

## 0.3.3

### Patch Changes

- 10aaf61: remove integration ordering requirements

## 0.3.2

### Patch Changes

- b76f267: better error messages

## 0.3.1

### Patch Changes

- b722dbe: pass parameters directly into setup script, omitting the config virtual module

## 0.3.0

### Minor Changes

- 0bd9206: add events for lifecycle hooks

## 0.2.3

### Patch Changes

- 40146f7: fix vite warning

## 0.2.2

### Patch Changes

- 6b80b5b: implement proper exit codes on errors during startup and shutdown

## 0.2.1

### Patch Changes

- 1d8f64f: fix warmup paths

## 0.2.0

### Minor Changes

- 0e17f69: add warmup and boot context

## 0.1.3

### Patch Changes

- c39febd: add project under development disclaimer

## 0.1.2

### Patch Changes

- 49d91c7: update dependencies
- fb3ab0a: rerun lifecycle hooks on reload, add dependency tracking
- 9207065: add `| undefined` for `exactOptionalPropertyTypes` compatibility

## 0.1.1

### Patch Changes

- b45d973: skip client builds, fix optional hooks

## 0.1.0

### Minor Changes

- b6fe3f6: initial version of boot package
