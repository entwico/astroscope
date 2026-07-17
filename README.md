# Astroscope

A collection of Astro integrations for server-side needs on **Node.js** — logging, tracing, security, i18n, and more.

Node.js is the only supported runtime. Other runtimes (Bun, Deno, Cloudflare Workers) are out of scope.

## Packages

| Package                                               | Description                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [@astroscope/eslint-plugin](./packages/eslint-plugin) | Additional ESLint rules for Astro projects. Plays well with `eslint-plugin-astro`.                                |
| [@astroscope/i18n](./packages/i18n)                   | i18n for Astro + React islands — dynamic translations from any source, auto-split per component, parallel loading |
| [@astroscope/node](./packages/node)                   | Opinionated, cloud-friendly Node adapter: boot lifecycle, health probes, request logging, telemetry, CSRF and static serving run as plain code around `server.listen()` |
| [@astroscope/proxy](./packages/proxy)                 | HTTP proxy for strangler fig migrations and API gateways                                                          |
| [@astroscope/components](./packages/components)       | Reusable Astro components for common page needs                                                                   |
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
