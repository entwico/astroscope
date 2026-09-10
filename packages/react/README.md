# @astroscope/react

React for Astro islands, tuned for the server. A thin wrapper around [`@astrojs/react`](https://docs.astro.build/en/guides/integrations-guide/react/) that owns everything React-SSR-specific in astroscope:

- **Synchronous island rendering** — `renderToString` per island, about 3x cheaper than upstream's stream-and-drain. Astro needs the full html string anyway.
- **Automatic streaming fallback** — an island that suspends on the server is re-rendered with `renderToReadableStream`, streamed from then on, and logged once with its component url.
- **SSR effect stripping** — effect callbacks are emptied in the SSR bundle, so client-only dynamic imports (maplibre-gl, hls.js, …) drop out of the server build.
- **Render telemetry** — `astro.island.render.duration` per island (component name, `string` or `stream` path), `astro.island.check.duration` for astro's per-render detection probe, and `astro.island.render.failures` (`root`: no html, `boundary`: a suspense boundary left to the client, logged with the component).

## Examples

Every React demo uses it: [demo/i18n](../../demo/i18n), [demo/wormhole](../../demo/wormhole), and [demo/node-e2e](../../demo/node-e2e), which has a suspending island exercising the streaming fallback.

## Installation

```bash
npm install @astroscope/react
```

`@astrojs/react` is a pinned dependency of this package: remove it from your own `package.json` unless you import one of its subpaths yourself (`@astrojs/react/actions`, `@astrojs/react/container-renderer`).

```ts
// astro.config.ts
import node from '@astroscope/node';
import react from '@astroscope/react';

export default defineConfig({
  output: 'server',
  adapter: node(),
  integrations: [react()],
});
```

Requires `@astroscope/node` (for the `log` proxy) and React 19.

## Options

All `@astrojs/react` options (`include`, `exclude`, `babel`) pass through. `experimentalReactChildren` and `experimentalDisableStreaming` are not supported: the renderer here already renders synchronously.

| Option         | Default | Description                                    |
| -------------- | ------- | ---------------------------------------------- |
| `stripEffects` | `true`  | Empty React effect callbacks in the SSR bundle |

## License

MIT
