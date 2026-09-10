# @astroscope/wormhole

Share dynamic server data with React islands and client scripts — typed, streamed with the HTML, sliced per island.

## Why this library?

Astro recommends [nanostores](https://docs.astro.build/en/recipes/sharing-state/) for sharing state between islands, but nanostores are client-only — there's no built-in way to hydrate them with server data during SSR.

`@astroscope/wormhole` bridges this gap: define your wormholes in a registry — each with the handler that resolves its value per request — and read them anywhere — Astro frontmatter, React islands, `<script>` blocks — through one typed `wormholes` proxy. Client code imports nothing of yours: the data streams into the HTML exactly where it is needed.

**Loading is scoped per route.** The build scans server and client code to see which wormholes each route can reach; at runtime only those handlers run for a request. A wormhole nothing on the route reads costs **nothing** — no database call, no bytes.

**Delivery is sliced per island.** Every island receives exactly the wormholes its code reads, embedded in the HTML right before it. A wormhole no client code reads ships **zero bytes**.

**Typical use cases:**

- Shopping cart state shared across header badge, product cards, and checkout
- Authenticated user / session data available in all islands
- Feature flags resolved on the server, consumed by client components
- Server-loaded configuration (theme, locale, permissions) bridged to the UI
- Any request-scoped data that multiple disconnected islands need to read

## Important notes

- **No secrets in wormholes.** Wormhole data is serialized into inline `<script>` tags and sent to the browser. Never store tokens, API keys, credentials, or any sensitive data in a wormhole. (In dev, _all_ open wormholes ship with every page; production slicing is an optimization, not a security boundary.)
- **Requires `@astroscope/node`** — per-island delivery uses its islands pipeline in production.
- **The registry is server-only.** It carries the handlers, and with them your server code. Client code must never import `src/wormholes.ts` — it accesses values through the `wormholes` proxy instead. (The client build fails on such an import, and the eslint plugin's `no-registry-import` rule flags it in island code.)
- **`set()` is client-only.** Server values are request-scoped and come from the handlers.
- **Values are deeply readonly.** `get()`, `subscribe()` and `useWormhole()` expose the value as `ReadonlyDeep<T>` — in-place mutation would silently bypass subscribers. The only way to update is `set()` with a new value: `wormholes.counter.set({ ...wormholes.counter.get(), count: 1 })`.
- **Prerendered pages get no wormhole data** — values are per-request by definition.

## Examples

See the [demo/wormhole](../../demo/wormhole) directory for a working example.

## Installation

```bash
npm install @astroscope/wormhole
```

```ts
// astro.config.ts
import node from '@astroscope/node';
import wormhole from '@astroscope/wormhole';

export default defineConfig({
  output: 'server',
  adapter: node(),
  integrations: [wormhole()],
});
```

The integration registers the build-time scanner, injects the middleware after your own `src/middleware.ts` (so handlers see everything it put on `locals`), and generates a type stub from your registry, so `wormholes.<name>` is fully typed everywhere. `wormhole({ exclude })` takes the same patterns as other astroscope middlewares (defaults to `RECOMMENDED_EXCLUDES`).

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

`src/wormholes/index.ts` works too. A handler receives the request's `APIContext` and runs only for routes the build found a reader on; return `undefined` to leave the wormhole closed for the request. Each request is isolated.

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

Accesses must be static (`wormholes.cart`, `wormholes['cart']`). A dynamic access (`wormholes[name]`) still works, but the build can no longer tell which wormholes that chunk needs and delivers all open ones to its islands.

### `defineWormhole({ handler, eager? })` <sub>registry only</sub>

Creates a typed wormhole for the registry; the value type is inferred from the handler (or given as `defineWormhole<T>(...)`), the name comes from the registry key. `eager: true` runs the handler on every request instead of only where the build found a reader — for wormholes read by islands the build cannot attribute to a route (components chosen dynamically at render time). Registry entries are full `Wormhole<T>` objects, so server code can also import `wormholes` from your own registry file directly.

### `openWormholes(wh, data, fn)` <sub>server only</sub>

Provides values to server code that runs outside the request pipeline — tests, out-of-request rendering. Never delivered to the client; inside the app, the middleware is the way. Accepts a single pair or an array of `[wormhole, data]` pairs.

### `useWormhole(wh)` <sub>React only</sub>

React hook that reads a wormhole and re-renders on `set()`. During SSR it reads the request scope, so server and client render identically.

### `UnwrapWormholes<R>`

Exported helper type mapping a registry shape to its value types. The recursively-readonly value type is `ReadonlyDeep<T>` from `@entwico/dash`.

## How it works

At build time the integration scans the code for `wormholes.<name>` reads: server modules are attributed to the routes whose page or endpoint reaches them, client modules to the emitted chunks. It also generates the types for the `wormholes` proxy from your registry. At runtime the middleware runs, in parallel, the handlers of everything the request's route can reach — frontmatter and endpoint reads, the islands the page hydrates (via `@astroscope/node`'s route map), its `<script>` blocks — and each island's data is embedded in the HTML right before it, so it is always there before the island's code runs, even while the page is still streaming. Routes the build could not attribute (dev, astro's own routes) load everything. On the client, `set()` updates the shared data and notifies subscribers, keeping islands and scripts in sync.

Each handler runs under its own `wormhole <name>` span beneath the request span — they run in parallel, and the trace shows which one holds the page's first byte — and records `astro.wormhole.handler.duration` {`astro.wormhole.name`}. A throwing handler is counted on `astro.wormhole.handler.failures` {`astro.wormhole.name`, `error.type`}, logged with its name, and fails the request. All through the adapter's telemetry, so nothing runs without its SDK.

## License

MIT
