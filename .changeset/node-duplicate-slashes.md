---
'@astroscope/node': patch
---

requests whose path carries duplicate slashes (`//weine`, `/seminare///x`) redirect to the collapsed path (301, 308 for non-GET)
