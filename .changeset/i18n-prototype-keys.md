---
'@astroscope/i18n': patch
---

keys, `rich()` tags and chunk names inherited from `Object.prototype` are unknown ones: `t()` falls back, `rich()` ignores the tag instead of throwing, the chunk endpoint answers 404 without echoing the name
