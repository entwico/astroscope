# @astroscope/wormhole

Share dynamic server data with React islands and client scripts — typed, streamed with the HTML, sliced per island.

Define your wormholes in a registry — each with the handler that resolves its value per request — and read them anywhere — Astro frontmatter, React islands, `<script>` blocks — through one typed `wormholes` proxy. Only the handlers a route can reach run for a request.

## Important notes

- **No secrets in wormholes.** Wormhole data is serialized into inline `<script>` tags and sent to the browser. Never store tokens, API keys, credentials, or any sensitive data in a wormhole.
- **Requires `@astroscope/node`.**
- **The registry is server-only.** Client code must never import `src/wormholes.ts` — it accesses values through the `wormholes` proxy instead.
- **`set()` is client-only.** Server values are request-scoped and come from the handlers.
- **Values are deeply readonly.** `get()`, `subscribe()` and `useWormhole()` expose the value as `ReadonlyDeep<T>`; update with `set()` and a new value: `wormholes.counter.set({ ...wormholes.counter.get(), count: 1 })`.
- **Prerendered pages get no wormhole data.**

## Examples

See the [demo/wormhole](../../demo/wormhole) directory for a working example.

## Installation

```bash
npm install @astroscope/wormhole
```

```ts
// astro.config.ts
import { defineConfig } from 'astro/config';
import node from '@astroscope/node';
import wormhole from '@astroscope/wormhole';

export default defineConfig({
  output: 'server',
  adapter: node(),
  integrations: [wormhole()],
});
```

The integration runs its middleware after your own `src/middleware.ts`, so handlers see everything it put on `locals`, and types `wormholes.<name>` from your registry. `wormhole({ exclude })` takes the same patterns as other astroscope middlewares (defaults to `RECOMMENDED_EXCLUDES`).

## Usage

### 1. Define the registry

One file, one export named `wormholes` — the keys are the wormhole names, each entry carries its handler (same pattern as Astro Actions' `src/actions/index.ts`):

```ts
// src/wormholes.ts
import { defineWormhole } from '@astroscope/wormhole';

export type Session = {
  user: string;
  role: string;
};

export const wormholes = {
  session: defineWormhole({
    handler: (ctx): Session => ({ user: ctx.locals.user, role: ctx.locals.role }),
  }),
  cart: defineWormhole({
    handler: async (ctx) => loadCart(ctx),
  }),
};
```

`src/wormholes/index.ts` works too. A handler receives the request's `APIContext`; return `undefined` to leave the wormhole closed for the request.

### 2. Read anywhere

#### Astro frontmatter (SSR)

```astro
---
import { wormholes } from '@astroscope/wormhole';

const { user } = wormholes.session.get();
---

<p>Hello, {user}</p>
```

#### React islands

```tsx
import { wormholes } from '@astroscope/wormhole';
import { useWormhole } from '@astroscope/wormhole/react';

export function UserBadge() {
  const { user, role } = useWormhole(wormholes.session);

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
  import { wormholes } from '@astroscope/wormhole';

  document.getElementById('user')!.textContent = wormholes.session.get().user;

  wormholes.session.subscribe((data) => {
    document.getElementById('user')!.textContent = data.user;
  });
</script>
```

### 3. Update from the client

Call `set()` to update the wormhole — every `useWormhole()` hook and `subscribe()` callback on the page reacts, across islands:

```tsx
import { wormholes } from '@astroscope/wormhole';
import { useWormhole } from '@astroscope/wormhole/react';
import { actions } from 'astro:actions';

export function RoleToggle() {
  const { user, role } = useWormhole(wormholes.session);

  async function toggle() {
    const result = await actions.updateRole({ role: role === 'admin' ? 'viewer' : 'admin' });

    if (!result.error) {
      wormholes.session.set(result.data);
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

### `wormholes` <sub>proxy, server + client</sub>

The single access point, typed from your registry. `wormholes.cart` returns a `Wormhole<T>`:

| Method                      | Description                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `wormholes.x.get()`         | Read the current value as `ReadonlyDeep<T>` (server: request scope; client: streamed data) |
| `wormholes.x.set(data)`     | Replace the value and notify all subscribers (client only)                                 |
| `wormholes.x.subscribe(fn)` | Listen for `set()` updates, returns an unsubscribe function                                |

Accesses must be static (`wormholes.cart`, `wormholes['cart']`).

### `defineWormhole({ handler, eager? })` <sub>registry only</sub>

Creates a typed wormhole for the registry; the value type is inferred from the handler (or given as `defineWormhole<T>(...)`), the name comes from the registry key. `eager: true` runs the handler on every request instead of only where the build found a reader — for wormholes read by islands the build cannot attribute to a route (components chosen dynamically at render time). Registry entries are full `Wormhole<T>` objects, so server code can also import `wormholes` from your own registry file directly.

### `openWormholes(wh, data, fn)` <sub>server only</sub>

```ts
import { openWormholes } from '@astroscope/wormhole/server';
```

Provides values to server code that runs outside the request pipeline — tests, out-of-request rendering. Never delivered to the client; inside the app, the middleware is the way. Accepts a single pair or an array of `[wormhole, data]` pairs.

### `useWormhole(wh)` <sub>React only</sub>

React hook that reads a wormhole and re-renders on `set()`.

### `UnwrapWormholes<R>`

Exported helper type mapping a registry shape to its value types. The recursively-readonly value type is `ReadonlyDeep<T>` from `@entwico/dash`.

## Telemetry

Each handler runs in a `wormhole <name>` span and records `astro.wormhole.handler.duration` {`astro.wormhole.name`}; a throwing handler counts on `astro.wormhole.handler.failures` {`astro.wormhole.name`, `error.type`}.

## License

MIT
