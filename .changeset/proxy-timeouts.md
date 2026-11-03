---
'@astroscope/proxy': major
---

the upstream is given 10 s to connect, 60 s to answer with headers and 60 s between body chunks, where there was no limit; `client.connectTimeout` / `headersTimeout` / `bodyTimeout` change them, `0` disables one
