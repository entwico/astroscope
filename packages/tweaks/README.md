# @astroscope/tweaks

> **Note:** This package is in active development. APIs may change between versions.

Small opinionated tweaks for Astro.

## Install

```sh
pnpm add @astroscope/tweaks
```

## Use

```ts
// astro.config.ts
import { defineConfig } from 'astro/config';
import tweaks from '@astroscope/tweaks';

export default defineConfig({
  integrations: [tweaks()],
});
```

All tweaks are on by default.

## Tweaks

| Option                 | Default | What it does                                                                                                                                                                                                                   |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ssrSourcemaps`        | `true`  | Emit sourcemaps for the SSR build so server stack traces are readable. The client bundle is left unmapped so browsers can't fetch source via `//# sourceMappingURL=`.                                                          |
| `ssrStripReactEffects` | `true`  | In the SSR pass, replace `useEffect` / `useLayoutEffect` / `useInsertionEffect` callback bodies with empty functions. Lets rolldown drop client-only dynamic imports from the SSR bundle. Does not change libs in node_modules |

Disable per feature if you have a reason:

```ts
tweaks({ ssrSourcemaps: false });
tweaks({ ssrStripReactEffects: false });
```

## License

MIT
