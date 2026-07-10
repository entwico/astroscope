# @astroscope/wormhole

> **Note:** This package is in active development. APIs may change between versions.

Share dynamic server data with React islands and client scripts — typed, reactive.

## Why this library?

Astro recommends [nanostores](https://docs.astro.build/en/recipes/sharing-state/) for sharing state between islands, but nanostores are client-only — there's no built-in way to hydrate them with server data during SSR.

`@astroscope/wormhole` bridges this gap: populate data in middleware, read it in Astro frontmatter, React islands, or `<script>` blocks — same typed API on server and client. Multiple wormholes per page, reactive updates across all consumers, zero configuration.

**Typical use cases:**

- Shopping cart state shared across header badge, product cards, and checkout
- Authenticated user / session data available in all islands
- Feature flags resolved on the server, consumed by client components
- Server-loaded configuration (theme, locale, permissions) bridged to the UI
- Any request-scoped data that multiple disconnected islands need to read

## Important notes

- **No secrets in wormholes.** All wormhole data is serialized into an inline `<script>` tag and sent to the browser. Never store tokens, API keys, credentials, or any sensitive data in a wormhole.
- **`set()` is client-only.** Calling `set()` does not work on the server. Use `open(wormhole, data, fn)` from `@astroscope/wormhole/server` to populate data in middleware.
- **Values are deeply readonly.** `get()`, `subscribe()` and `useWormhole()` expose the value as `DeepReadonly<T>` — in-place mutation would silently bypass subscribers (and on the server would corrupt the request-scoped store). The only way to update is `set()` with a new value: `wh.set({ ...wh.get(), count: 1 })`.

## Examples

See the [demo/wormhole](../../demo/wormhole) directory for a working example.

## Installation

```bash
npm install @astroscope/wormhole
```

## Usage

### 1. Define a wormhole

Create a shared file imported by both server and client code:

```ts
// src/wormholes.ts
import { defineWormhole } from '@astroscope/wormhole';

export type UserState = {
  user: string;
  role: string;
};

export const userState = defineWormhole<UserState>('user');
```

### 2. Populate in middleware

Use `open()` from the server entry point to provide data during request handling:

```ts
// src/middleware.ts
import { open } from '@astroscope/wormhole/server';
import { defineMiddleware } from 'astro:middleware';
import { userState } from './wormholes';

export const onRequest = defineMiddleware((ctx, next) => {
  const data = { user: 'Alice', role: 'admin' };

  return open(userState, data, () => next());
});
```

`open()` uses `AsyncLocalStorage` under the hood — each request gets its own isolated data.

### 3. Bridge to the client

Add `<WormholeScript>` to your layout to serialize the data into an inline script:

```astro
---
import { WormholeScript } from '@astroscope/wormhole/astro';
import { userState } from '../wormholes';
---

<html>
  <head>
    <WormholeScript wormhole={userState} />
  </head>
  <body>
    <slot />
  </body>
</html>
```

### 4. Read in components

#### Astro frontmatter (SSR)

```astro
---
import { userState } from '../wormholes';

const { user } = userState.get();
---

<p>Hello, {user}</p>
```

#### React islands

```tsx
import { useWormhole } from '@astroscope/wormhole/react';
import { userState } from '../wormholes';

export function UserBadge() {
  const { user, role } = useWormhole(userState);

  return (
    <span>
      {user} ({role})
    </span>
  );
}
```

#### Astro `<script>` blocks

```astro
<p>User: <strong id="user">-</strong></p>

<script>
  import { userState } from '../wormholes';

  document.getElementById('user')!.textContent = userState.get().user;

  userState.subscribe((data) => {
    document.getElementById('user')!.textContent = data.user;
  });
</script>
```

### 5. Update from the client

Call `set()` to update the wormhole — all `useWormhole()` hooks and `subscribe()` callbacks react immediately:

```tsx
import { useWormhole } from '@astroscope/wormhole/react';
import { actions } from 'astro:actions';
import { userState } from '../wormholes';

export function RoleToggle() {
  const { user, role } = useWormhole(userState);

  async function toggle() {
    const newRole = role === 'admin' ? 'viewer' : 'admin';
    const result = await actions.updateRole({ role: newRole });

    if (!result.error) {
      userState.set(result.data);
    }
  }

  return (
    <button onClick={toggle}>
      {user}: {role}
    </button>
  );
}
```

## API

### `defineWormhole<T>(name)`

Creates a typed wormhole channel. The returned object is universal — works on both server and client.

```ts
import { defineWormhole } from '@astroscope/wormhole';

const wh = defineWormhole<{ count: number }>('counter');
```

| Method             | Description                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `wh.get()`         | Read current value as `DeepReadonly<T>` (from `AsyncLocalStorage` on server, from `globalThis` or local store on client) |
| `wh.set(data)`     | Replace value with a new one and notify all subscribers (client-side)                               |
| `wh.subscribe(fn)` | Listen for changes, returns unsubscribe function                                                    |
| `wh.name`          | The wormhole name                                                                                   |
| `wh.key`           | The internal `globalThis` key                                                                       |

### `DeepReadonly<T>`

Exported helper type — recursively `readonly` version of `T`. Wormhole values are exposed with this type; use it in your own function signatures when passing wormhole data around:

```ts
import type { DeepReadonly } from '@astroscope/wormhole';

function isWithinCart(cart: DeepReadonly<Cart>, id: string) {
  return cart.items.some((item) => item.productId === id);
}
```

### `open(wh, data, fn)` <sub>server only</sub>

Runs `fn` with `data` available via `wh.get()` for the duration of the call. Uses `AsyncLocalStorage` for request isolation.

```ts
import { open } from '@astroscope/wormhole/server';

return open(myWormhole, { count: 0 }, () => next());
```

To open several wormholes at once, pass an array of `[wormhole, data]` pairs — each pair is type-checked against its own wormhole:

```ts
return open([
  [cartStore, cart],
  [sessionStore, session],
], () => next());
```

Nested `open()` calls shadow only the wormholes they name; everything else stays visible.

### `useWormhole(wh)` <sub>React only</sub>

React hook that reads the wormhole and re-renders on changes. Uses `useSyncExternalStore` internally.

```tsx
import { useWormhole } from '@astroscope/wormhole/react';

const data = useWormhole(myWormhole);
```

### `<WormholeScript wormhole={wh} />` <sub>Astro only</sub>

Serializes the current wormhole value into an inline `<script>` tag for client hydration.

```astro
import {WormholeScript} from '@astroscope/wormhole/astro';

<WormholeScript wormhole={myWormhole} />
```

## How it works

1. **Middleware** calls `open(wh, data, next)` — stores data in `AsyncLocalStorage` and sets `globalThis[key]` to read from it
2. **`<WormholeScript>`** calls `wh.get()` during SSR, serializes the result into `<script is:inline>globalThis[key] = function(){return data;}</script>`
3. **Client** calls `wh.get()` — reads from `globalThis[key]()` (the serialized getter)
4. **`set()`** updates a local store and notifies all subscribers — `useWormhole()` hooks and `subscribe()` callbacks re-render/fire

## License

MIT
