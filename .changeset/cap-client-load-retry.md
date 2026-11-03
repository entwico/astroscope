---
'@astroscope/cap': patch
---

`solveCap()` / `useCap()`: concurrent solves each resolve a token, a cap client that failed to load is retried by the next solve, and `ensure()` resolves `null` instead of rejecting when a custom solver throws
