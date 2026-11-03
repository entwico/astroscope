---
'@astroscope/node': major
---

idle keep-alive connections stay open 120 s by default, above the idle timeout of traefik, nginx and the cloud balancers, so a proxy no longer reuses a connection node is closing; `keepAliveTimeout` sets it
