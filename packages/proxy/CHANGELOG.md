# @astroscope/proxy

## 1.0.0

### Major Changes

- bdbf485: every package of this release is a major: the audit behind it changed behaviour applications may have relied on, so read the entries before upgrading
- bdbf485: a hook that throws answers 500 instead of 502 "Upstream is down", and releases the upstream connection
- bdbf485: hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`, …) are forwarded in neither direction; chunked uploads and `expect: 100-continue` requests reach the upstream instead of failing with 502
- bdbf485: the upstream is given 10 s to connect, 60 s to answer with headers and 60 s between body chunks, where there was no limit; `client.connectTimeout` / `headersTimeout` / `bodyTimeout` change them, `0` disables one
- bdbf485: the path of the `upstream` url, previously ignored, is put in front of every proxied path; an upstream with credentials, a query or a fragment is rejected
- bdbf485: redirects to the upstream's own origin are rewritten to the site, and cookies scoped to the upstream host lose their `Domain`

### Minor Changes

- bdbf485: the upstream receives `x-forwarded-for` (client address appended), `x-forwarded-host` and `x-forwarded-proto`

### Patch Changes

- bdbf485: the upstream body is read only as fast as the client consumes it; a connection that breaks mid-body errors the response instead of hanging
- bdbf485: a 205 (and any other null-body status) from the upstream is passed through instead of answering 502

## 0.4.1

### Patch Changes

- 42e84ba: update deps

## 0.4.0

### Minor Changes

- 329f3f2: support Astro 7 (Vite 8)

## 0.3.3

### Patch Changes

- a47a328: update deps

## 0.3.2

### Patch Changes

- af5b6d5: update license

## 0.3.1

### Patch Changes

- b65b90d: externalize package for astro

## 0.3.0

### Minor Changes

- ad74a23: add astro@6 support

## 0.2.5

### Patch Changes

- 377fe18: update dependencies

## 0.2.4

### Patch Changes

- c39febd: add project under development disclaimer

## 0.2.3

### Patch Changes

- 49d91c7: update dependencies
- 9207065: add `| undefined` for `exactOptionalPropertyTypes` compatibility

## 0.2.2

### Patch Changes

- 1a8f42c: fix destroy already destroyed body error

## 0.2.1

### Patch Changes

- 98af2d0: fix abort errors for 204 / 304

## 0.2.0

### Minor Changes

- 93f48e8: change hooks signature to provide astro context

## 0.1.1

### Patch Changes

- 69e50bd: fixed abort errors

## 0.1.0

### Minor Changes

- 2881bfd: initial proxy package
