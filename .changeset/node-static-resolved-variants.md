---
'@astroscope/node': patch
---

pre-compressed variants are served for directory indexes, extension-less pages of `build.format: 'file'` and percent-encoded file names, and never for an encoding the request refuses with `q=0`
