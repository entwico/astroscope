---
'@astroscope/react': patch
---

only the resources react hoists ahead of an island are dropped; in-place stylesheets, slot html and script text keep their `<link>` tags
