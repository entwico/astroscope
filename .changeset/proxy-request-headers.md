---
'@astroscope/proxy': major
---

hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`, …) are forwarded in neither direction; chunked uploads and `expect: 100-continue` requests reach the upstream instead of failing with 502
