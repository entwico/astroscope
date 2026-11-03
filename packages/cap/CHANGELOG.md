# @astroscope/cap

## 2.0.0

### Major Changes

- bdbf485: every package of this release is a major: the audit behind it changed behaviour applications may have relied on, so read the entries before upgrading
- bdbf485: `cap.configure()` rejects a base url that is not an absolute http(s) url and a site key containing `/`, `?` or `#`
- bdbf485: Cap refusing the site key or secret now denies as unavailable with an error log instead of rejecting every visitor as if their token were bad
- bdbf485: requests to the Cap service follow no redirect, so a redirecting service can never receive the secret or a visitor's request elsewhere
- bdbf485: the challenge/redeem proxy times out after 10 s with a `504` and stops the upstream request when the browser disconnects

### Patch Changes

- bdbf485: `solveCap()` / `useCap()`: concurrent solves each resolve a token, a cap client that failed to load is retried by the next solve, and `ensure()` resolves `null` instead of rejecting when a custom solver throws
- bdbf485: a click on the widget's credits link opens the vendor site without the page url, a referrer or `window.opener`
- bdbf485: a token guarded by `captcha()` in both the middleware and the page is verified once
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
  - @astroscope/node@5.0.0

## 1.0.1

### Patch Changes

- c5466dd: fix the dev server: the cap client is no longer pre-bundled, and the pako fallback gets a real url
- Updated dependencies [6ca871e]
  - @astroscope/node@4.1.0

## 1.0.0

### Major Changes

- 2f9f809: Cap captcha for Astro: same-origin proxy to the cap service, the `captcha()` guard for actions, endpoints and pages, invisible solving and the checkbox widget

### Patch Changes

- Updated dependencies [2f9f809]
- Updated dependencies [2f9f809]
- Updated dependencies [2f9f809]
  - @astroscope/node@4.0.0
