# @astroscope/boot

> **Note:** This package is in active development. APIs may change between versions.

Startup and graceful shutdown hooks for Astro SSR. Run initialization code before the server starts and cleanup code when it shuts down.

## Examples

See the [demo/boot](../../demo/boot) directory for a working example.

## Installation

```bash
npm install @astroscope/boot
```

## Usage

1. Create a boot file at `src/boot.ts` (or `src/boot/index.ts`):

```ts
// src/boot.ts
import type { BootContext } from '@astroscope/boot';

export async function onStartup({ dev, host, port }: BootContext) {
  console.log('Starting up...');

  await someAsyncInitialization();

  console.log(`Ready at ${host}:${port} (dev: ${dev})`);
}

export async function onShutdown({ dev }: BootContext) {
  console.log('Shutting down...');

  await closeConnections();

  console.log('Goodbye!');
}
```

2. Add the integration to your Astro config:

```ts
// astro.config.ts
import { defineConfig } from 'astro/config';
import boot from '@astroscope/boot';

export default defineConfig({
  output: 'server',
  integrations: [boot()],
});
```

**IMPORTANT**: for watch mode (default) it is better to keep the boot integration last in the integrations list

## Boot Context

Both `onStartup` and `onShutdown` receive a `BootContext` object:

```ts
interface BootContext {
  /** Whether running in development mode */
  dev: boolean;
  /** Server host (from Astro config or HOST env var) */
  host: string;
  /** Server port (from Astro config or PORT env var) */
  port: number;
}
```

In development, `host` and `port` are read from the actual server address. In production, they default to Astro config values but can be overridden via `HOST` and `PORT` environment variables at runtime.

## Lifecycle Hooks

### `onStartup`

Called before the server starts handling requests. Use this for:

- Database connection initialization
- Loading configuration
- Warming caches
- Setting up external service clients

### `onShutdown`

Called when the server is shutting down (SIGTERM in production, server close in development). Use this for:

- Closing database connections
- Flushing buffers
- Cleaning up resources
- Graceful shutdown of external services

## Warmup

Enabled by default. Pre-imports the modules the SSR server actually loads on the first requests, so the first request doesn't pay the cost of evaluating route and middleware modules from cold.

The preloaded chunks are determined by

- astro pages
- api routes
- actions
- middleware

Warmup runs in parallel with `onStartup` and is awaited before the server starts handling requests.

To disable:

```ts
boot({ warmup: false });
```

## Options

### `entry`

Path to the boot file relative to the project root.

- **Type**: `string`
- **Default**: `"src/boot.ts"`

```ts
boot({ entry: 'src/startup.ts' });
```

### `watch`

Restart the dev server when the boot file (or any of its dependencies) changes, and when Vite issues an SSR full-reload (which would otherwise wipe singletons configured in `onStartup`).

Make sure your `onShutdown` releases everything `onStartup` acquired (sockets, ports, intervals, locks) — the previous module is fully shut down before the new one starts on each restart.

- **Type**: `boolean`
- **Default**: `true`

```ts
boot({ watch: false });
```

### `warmup`

Pre-import server modules on startup to eliminate cold-start latency on the first request. Production-only — no effect in dev. See [Warmup](#warmup) above for details.

- **Type**: `boolean`
- **Default**: `true`

```ts
boot({ warmup: false });
```

## Requirements

- Node.js runtime
- SSR output mode (`output: "server"`)

## License

MIT
