---
'@astroscope/node': major
---

`bodySizeLimit` defaults to 1 MiB (was 1 GiB) and applies to every request, in dev too: a larger body is refused with 413. Raise it for routes that accept bigger uploads
