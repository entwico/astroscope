---
'@astroscope/node': patch
---

error answers for static files (`416`, `412`, `500`) no longer carry the file's `Content-Length`, `Content-Encoding`, `ETag` and immutable `Cache-Control`, and a `416` has its `Content-Range`
