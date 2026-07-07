# @astroscope/i18n

## 0.6.1

### Patch Changes

- 6d10301: no more invisible bidi isolation characters around interpolated variables

## 0.6.0

### Minor Changes

- 329f3f2: support Astro 7 (Vite 8)

### Patch Changes

- 6b4669d: upgrade the build-time t() extraction to Babel 8
- Updated dependencies [329f3f2]
  - @astroscope/excludes@0.4.0

## 0.5.0

### Minor Changes

- eafcbd5: inconsistent translation keys now fail the build by default

### Patch Changes

- eafcbd5: Log a clear error instead of crashing when `<I18nScript />` is missing

## 0.4.6

### Patch Changes

- a204b4a: bump @astrojs/compiler to v4 to align with astro 6

## 0.4.5

### Patch Changes

- a47a328: update deps
- Updated dependencies [a47a328]
  - @astroscope/excludes@0.3.2

## 0.4.4

### Patch Changes

- c46ffba: print log message instead of throw on missing i18n configuration

## 0.4.3

### Patch Changes

- af5b6d5: update license
- Updated dependencies [af5b6d5]
  - @astroscope/excludes@0.3.1

## 0.4.2

### Patch Changes

- e7f0a69: remove glob dependency

## 0.4.1

### Patch Changes

- e9ed961: update versions

## 0.4.0

### Minor Changes

- ad74a23: add astro@6 support

### Patch Changes

- 591021f: properly invalidate the chunks cache
- Updated dependencies [ad74a23]
  - @astroscope/excludes@0.3.0

## 0.3.4

### Patch Changes

- df664a1: fix dev mode not being reloading fallbacks for translation tokens

## 0.3.3

### Patch Changes

- 873b3ac: update excludes version

## 0.3.2

### Patch Changes

- 377fe18: update dependencies

## 0.3.1

### Patch Changes

- 185e849: add inconsistency check

## 0.3.0

### Minor Changes

- f9b6b1b: upgrade to messageformat 2
- cfe27ad: add rich() function, rename exports @astroscope/i18n/t -> translate and @astroscope/i18n/components -> astro

## 0.2.4

### Patch Changes

- 97a95ce: properly handle multiple occurences of the same translation key

## 0.2.3

### Patch Changes

- 08cd4b9: fix extracting from astro files w/ type imports

## 0.2.2

### Patch Changes

- f48fb2f: fix dev mode extraction & deduplicate extracted tokens
- d2bfb25: add translation chunks cache

## 0.2.1

### Patch Changes

- 50babbf: better performance for nested chunks with i18n tokens
- c39febd: add project under development disclaimer
- Updated dependencies [43c3be2]
- Updated dependencies [c39febd]
  - @astroscope/excludes@0.1.3

## 0.2.0

### Minor Changes

- e69273a: add excludes for i18n middleware

### Patch Changes

- 49d91c7: update dependencies
- Updated dependencies [49d91c7]
  - @astroscope/excludes@0.1.2

## 0.1.0

### Minor Changes

- c9bf4e3: initialize i18n
