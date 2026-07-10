---
'@astroscope/node': minor
---

embed request logging and OpenTelemetry: `log` proxy at `@astroscope/node/log` with early-log buffering, request logging and server spans at the native handler, platform telemetry defaults (undici fetch instrumentation, runtime/host metrics, Prometheus reader), and auto-detected entry files (`src/config.ts`, `src/instrumentation.ts`, `src/log.ts`) — replaces `@astroscope/pino` and `@astroscope/opentelemetry`
