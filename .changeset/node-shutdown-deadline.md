---
'@astroscope/node': major
---

`shutdownTimeout` also bounds `onShutdown` and the telemetry flush: a hanging phase is logged and the process exits instead of waiting for the orchestrator to kill it
