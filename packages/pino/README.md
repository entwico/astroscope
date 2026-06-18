# @astroscope/pino

> **Note:** This package is in active development. APIs may change between versions.

Pino logging with request-scoped context via AsyncLocalStorage. Familiar pino-http style API.

## Features

- **inspired by pino-http** - same log structure, messages, and field names
- **request-scoped logging** - via AsyncLocalStorage

## Installation

```bash
npm install @astroscope/pino pino @astroscope/excludes
```

## Quick Start

### Integration

```ts
// astro.config.ts
import pino from '@astroscope/pino';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [pino()],
});
```

By default, `RECOMMENDED_EXCLUDES` (static assets like `/_astro/`) are excluded. To customize:

```ts
// astro.config.ts
import pino from '@astroscope/pino';
import { RECOMMENDED_EXCLUDES } from '@astroscope/excludes';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [
    pino({
      exclude: [...RECOMMENDED_EXCLUDES, { exact: '/health' }],
    }),
  ],
});
```

### Extended Logging

By default, only `method` and `url` are logged. To include query parameters, headers, and client IP address, enable extended logging:

```ts
pino({ extended: true });
```

> **Privacy note**: Extended logging may capture sensitive data (auth tokens, PII in query strings). Only enable in environments where this is acceptable and compliant with your privacy policies (e.g., GDPR).

### Custom Logger Configuration

For custom configuration (e.g., reading from environment variables at runtime), use `log.configure()` in boot.ts. This requires the [@astroscope/boot](https://github.com/entwico/astroscope/tree/main/packages/boot) integration:

```ts
// src/boot.ts
import { log } from '@astroscope/pino';

export function onStartup() {
  log.configure({
    level: process.env.LOG_LEVEL ?? 'info',
  });
}
```

### Manual Middleware

If you need full control over middleware ordering, you can use `createPinoMiddleware` directly instead of the integration. When using manual middleware, do not add the pino integration to your astro.config.ts.

```ts
// src/middleware.ts
import { sequence } from 'astro:middleware';
import { createPinoMiddleware } from '@astroscope/pino';
import { RECOMMENDED_EXCLUDES } from '@astroscope/excludes';

export const onRequest = sequence(
  createPinoMiddleware({
    exclude: [...RECOMMENDED_EXCLUDES, { exact: '/health' }],
  }),
);
```

## Logger API

### `log`

Context-aware logger with getter-based API. Automatically uses request context when available.

```ts
import { log } from '@astroscope/pino';

export async function GET() {
  log.info('handling request');
  log.info({ userId: 123 }, 'user logged in');
  return new Response('ok');
}
```

### `log.child(bindings)`

Create a child logger with additional context.

```ts
import { log } from '@astroscope/pino';

async function queryDatabase() {
  const dbLog = log.child({ component: 'db' });
  dbLog.debug('executing query');
}
```

### `log.raw`

Access the current context's raw pino Logger when you need full pino API.

```ts
import { log } from '@astroscope/pino';

log.raw.level; // 'info'
log.raw.bindings(); // { reqId: 'abc123' }
log.raw.isLevelEnabled('debug');
```

### `log.root`

Access the root logger (without request context bindings).

```ts
import { log } from '@astroscope/pino';

// useful for startup/shutdown messages
log.root.info('server starting');
```

### `log.configure(logger | options)`

Configure the root logger. Call this in boot.ts for custom configuration.

```ts
import { log } from '@astroscope/pino';

// pass options
log.configure({ level: 'debug' });

// or pass a pino instance
import pino from 'pino';
log.configure(pino({ level: 'debug' }));
```

## Disabling Astro's Node Adapter Logging

When using `@astrojs/node`, the adapter adds its logs by default. To prevent duplicate logging, you can disable the adapter's built-in logging with `ASTRO_NODE_LOGGING` environment variable:

```bash
ASTRO_NODE_LOGGING=disabled
```

## License

MIT
