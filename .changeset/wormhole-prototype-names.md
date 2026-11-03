---
'@astroscope/wormhole': patch
---

wormholes named like an `Object.prototype` member (`constructor`, `toString`, …) are delivered as own entries; `__proto__` is rejected as a name
