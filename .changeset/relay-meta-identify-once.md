---
'@astroscope/relay': patch
---

the meta pixel gets the visitor's identifiers once per page, with the first set tracked; a later different set no longer triggers a second `init` the pixel refuses with a "Duplicate Pixel ID" warning
