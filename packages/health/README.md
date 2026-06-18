# @astroscope/health

> **Note:** This package is in active development. APIs may change between versions.

Kubernetes-style health check endpoints for Astro SSR. Provides `/livez`, `/readyz`, `/startupz`, and `/healthz` probes on a separate HTTP server. Automatically manages probe lifecycle via [@astroscope/boot](../boot).

[health-probes](https://github.com/entwico/health-probes) is used under the hood. If you need more control, you can use it directly in your boot file instead of this integration.

## Examples

See the [demo/health](../../demo/health) directory for a working example.

## Installation

```bash
npm install @astroscope/health health-probes
```

## Usage

### 1. Add both integrations to your Astro config

```ts
// astro.config.ts
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import boot from '@astroscope/boot';
import health from '@astroscope/health';

export default defineConfig({
  adapter: node({ mode: 'standalone' }),
  integrations: [
    boot(),
    // in k8s use '0.0.0.0' to allow kubelet to access probes
    // do not expose the health server publicly unless necessary
    // by default is 127.0.0.1 for security reasons
    health({ host: '0.0.0.0' }),
  ],
});
```

This would set up the health server in production mode, disabled in dev mode by default.

### 2. Register health checks in your boot file

The health server and probe lifecycle are managed automatically — you only need to register your health checks:

```ts
// src/boot.ts
import type { BootContext } from '@astroscope/boot';
import { checks } from 'health-probes';

export async function onStartup({ dev, host, port }: BootContext) {
  await connectToDatabase();

  // register health checks
  checks.register('database', () => ({
    status: db.isConnected() ? 'healthy' : 'unhealthy',
    error: db.isConnected() ? undefined : 'connection lost',
  }));

  console.log(`Server ready at ${host}:${port}`);
}

export async function onShutdown() {
  await disconnectFromDatabase();
}
```

### What happens automatically

The integration hooks into boot lifecycle events to manage probes:

1. **Before `onStartup`**: health server starts, liveness probe enabled
2. **After `onStartup`**: startup and readiness probes enabled
3. **Before `onShutdown`**: readiness probe disabled (stops receiving traffic)
4. **After `onShutdown`**: health server stopped

This ensures Kubernetes sees the correct state at each phase — liveness is available immediately, readiness only after your app has fully initialized, and traffic stops before shutdown begins.

## Options

```ts
health({
  host: '0.0.0.0', // default: "127.0.0.1"
  port: 9090, // default: 9090
  paths: SimplePaths, // default: K8sPaths
  dev: true, // default: false
});
```

### `host`

Host to bind the health server to. Defaults to `127.0.0.1` (localhost only). Set to `0.0.0.0` when probes need to be reachable from outside the host, e.g. in Kubernetes where the kubelet sends requests to the pod IP.

- **Type**: `string`
- **Default**: `"127.0.0.1"`
- **Env**: `HEALTH_HOST`

### `port`

Port for the health server.

- **Type**: `number`
- **Default**: `9090`
- **Env**: `HEALTH_PORT`

### `paths`

Probe endpoint paths. Two presets are available:

- `K8sPaths` (default): `/livez`, `/readyz`, `/startupz`, `/healthz`
- `SimplePaths`: `/live`, `/ready`, `/startup`, `/health`

```ts
import health from '@astroscope/health';
import { SimplePaths } from 'health-probes';

health({ paths: SimplePaths });
```

### `dev`

Enable the health server in development mode. By default, health probes only run in production builds.

- **Type**: `boolean`
- **Default**: `false`

## Probes

### `/livez` — Liveness Probe

Indicates if the process is running. If this fails, Kubernetes restarts the container.

### `/startupz` — Startup Probe

Indicates if the application has finished initializing. Kubernetes waits for this before sending traffic or checking liveness.

### `/readyz` — Readiness Probe

Indicates if the application is ready to receive traffic. When disabled or when required health checks fail, Kubernetes removes the pod from load balancer rotation.

The readiness probe automatically runs all non-optional health checks and returns 503 if any fail.

### `/healthz` — Health Status

Returns detailed JSON status of all probes and health checks:

```json
{
  "status": "healthy",
  "probes": {
    "livez": true,
    "startupz": true,
    "readyz": true
  },
  "checks": {
    "database": {
      "status": "healthy",
      "latency": 12
    },
    "redis": {
      "status": "unhealthy",
      "latency": 5003,
      "error": "check \"redis\" timed out after 5000ms"
    }
  }
}
```

Status values:

- `healthy` — all checks pass
- `degraded` — optional checks failing, required checks pass
- `unhealthy` — required checks failing

## Health Checks

Register health checks to verify dependencies are working:

```ts
import { checks } from 'health-probes';

// return result (recommended for boolean checks)
checks.register('database', () => ({
  status: db.isConnected() ? 'healthy' : 'unhealthy',
  error: db.isConnected() ? undefined : 'connection lost',
}));

// throw-based (classic pattern)
checks.register('cache', async () => {
  await redis.ping(); // throws if fails
});

// with options
checks.register({
  name: 'external-api',
  check: () => fetch('https://api.example.com/health').then(() => {}),
  optional: true, // doesn't affect /readyz, only /healthz status
  timeout: 10000, // custom timeout (default: 5000ms)
});
```

The check function can either:

- Return `HealthCheckResult` with status and optional error
- Return `void` (completing without error = healthy)
- Throw an error (= unhealthy with error message)

### Unregistering Checks

`register()` returns an unregister function:

```ts
const unregister = checks.register('database', () => db.ping());

// later...
unregister();
```

## Kubernetes Configuration

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: app
      ports:
        - containerPort: 4321 # astro
        - containerPort: 9090 # health
      livenessProbe:
        httpGet:
          path: /livez
          port: 9090
        initialDelaySeconds: 0
        periodSeconds: 10
      startupProbe:
        httpGet:
          path: /startupz
          port: 9090
        failureThreshold: 30
        periodSeconds: 2
      readinessProbe:
        httpGet:
          path: /readyz
          port: 9090
        periodSeconds: 5
```

## License

MIT
