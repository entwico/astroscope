# Astroscope

> **Note:** This project is in active development. APIs may change between versions.

A collection of Astro integrations for common server-side needs — logging, tracing, security, i18n, and more.

**Runtime:** Node.js. Other runtimes (Bun, Deno, Cloudflare Workers) _may work_ but are not tested or officially supported.

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
