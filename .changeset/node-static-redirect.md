---
'@astroscope/node': patch
---

the static handler never redirects: the trailing-slash setting is enforced by the path redirect ahead of it, which refuses paths browsers resolve against another host
