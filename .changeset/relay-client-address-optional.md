---
'@astroscope/relay': major
---

`RelayRequest.clientAddress` is `string | undefined`: prerendered pages and adapters without one no longer throw in server `track()` or trigger astro's header warning per page
