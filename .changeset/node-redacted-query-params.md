---
'@astroscope/node': minor
---

server spans and extended request logs redact the values of sensitive query parameters, by default the signed-url credentials of the OpenTelemetry conventions (`OTEL_REDACTED_QUERY_PARAMS`); `redactedQueryParams` sets the list
