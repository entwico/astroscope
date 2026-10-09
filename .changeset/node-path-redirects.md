---
'@astroscope/node': minor
---

a wrong trailing slash redirects to the canonical path like duplicate slashes, in dev too (astro's dev server answered a 404); both redirects carry their own route label (`duplicate-slashes`, `trailing-slash`)
