# Astroscope

> **Note:** This project is in active development. APIs may change between versions.

A collection of Astro integrations for common server-side needs — logging, tracing, security, i18n, and more.

**Runtime:** Node.js. Other runtimes (Bun, Deno, Cloudflare Workers) _may work_ but are not tested or officially supported.

## Packages

| Package                                               | Description                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [@astroscope/boot](./packages/boot)                   | Startup and graceful shutdown lifecycle hooks                                                                     |
| [@astroscope/csrf](./packages/csrf)                   | CSRF protection with path exclusions for webhooks and OIDC callbacks                                              |
| [@astroscope/eslint-plugin](./packages/eslint-plugin) | Additional ESLint rules for Astro projects. Plays well with `eslint-plugin-astro`.                                |
| [@astroscope/excludes](./packages/excludes)           | Reusable exclude patterns and helpers for middleware                                                              |
| [@astroscope/health](./packages/health)               | Kubernetes-style health probes — livez, readyz, startupz, healthz                                                 |
| [@astroscope/hyperspace](./packages/hyperspace)       | Build-time brotli/gzip compression with in-memory serving — better compression, zero runtime overhead             |
| [@astroscope/i18n](./packages/i18n)                   | i18n for Astro + React islands — dynamic translations from any source, auto-split per component, parallel loading |
| [@astroscope/opentelemetry](./packages/opentelemetry) | OpenTelemetry tracing and metrics — works in dev mode, no monkey-patching                                         |
| [@astroscope/pino](./packages/pino)                   | Pino logging with request-scoped context                                                                          |
| [@astroscope/proxy](./packages/proxy)                 | HTTP proxy for strangler fig migrations and API gateways                                                          |
| [@astroscope/spare-parts](./packages/spare-parts)     | Reusable Astro components for common client needs                                                                 |
| [@astroscope/tweaks](./packages/tweaks)               | Small opinionated tweaks for Astro                                                                                |
| [@astroscope/wormhole](./packages/wormhole)           | Share dynamic server data with React islands and client scripts — typed, reactive                                 |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run demo app
pnpm dev

# Run tests
pnpm test

# Typecheck
pnpm typecheck
```

## License

MIT
