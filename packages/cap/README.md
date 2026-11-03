# @astroscope/cap

[Cap](https://capjs.js.org) captcha for Astro, invisible or as the checkbox widget. The browser solves a proof-of-work challenge against your own origin, the solved token travels with the request in a `_cap` field, and the `captcha` guard verifies it where the request lands: an action, an endpoint or a page.

## Installation

```bash
pnpm add @astroscope/cap
```

Requires `@astroscope/node` as the adapter. React is optional (only for `@astroscope/cap/react`).

## Usage

### 1. Add the integration

```ts
// astro.config.ts
import cap from '@astroscope/cap';
import node from '@astroscope/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  adapter: node(),
  integrations: [cap()],
});
```

| Option | Default    |                                                   |
| ------ | ---------- | ------------------------------------------------- |
| `path` | `'/_cap/'` | Prefix the challenge/redeem proxy is served under |

The proxy middleware is injected automatically (`pre` order), so `src/middleware.ts` stays untouched.

### 2. Configure the service in your boot file

The credentials are runtime secrets, so they never go into `astro.config.ts`:

```ts
// src/boot.ts
import { cap } from '@astroscope/cap';
import { Config } from '@/config';

export function onStartup() {
  cap.configure({
    baseUrl: Config.services.cap.baseUrl, // e.g. http://cap.cap:3000
    siteKey: Config.services.cap.siteKey,
    secretKey: Config.services.cap.secretKey,
  });
}
```

`baseUrl` is the service's origin with an optional base path. Until `cap.configure()` has run, the proxy answers `503` and the guard denies with `SERVICE_UNAVAILABLE`. A service that cannot be reached answers `502`, one that does not answer within 10 s `504`; redirects from the service are not followed.

### 3. Guard the request

```ts
// src/actions/index.ts
import { captcha } from '@astroscope/cap/server';
import { defineAction } from '@astroscope/node/guards';
import { z } from 'astro/zod';

export const server = {
  subscribe: defineAction({
    input: z.object({ email: z.email() }),
    guards: [captcha()],
    handler: async ({ email }) => {
      // only reached with a verified token; `_cap` is stripped from the input
    },
  }),
};
```

The guard adds `_cap` to the input schema itself; put `rateLimit` ahead of it, so a flood of invented tokens never reaches siteverify. The same `captcha()` goes into `defineRoute` for endpoints and `guard(Astro, [...])` for pages — see [`@astroscope/node/guards`](../node/README.md#guards) for `rateLimit`, `defineRoute` and `guard`. On a json or form body the token is read from the `_cap` field.

### 4. Solve on the client

Invisible, with React:

```tsx
import { useCap } from '@astroscope/cap/react';
import { actions } from 'astro:actions';

export function NewsletterForm() {
  const cap = useCap();

  const onSubmit = async (email: string) => {
    const _cap = await cap.ensure();

    if (_cap === null) {
      // solving failed (no WebAssembly, blocked as automated, cap unreachable)
      return;
    }

    const { error } = await actions.subscribe({ email, _cap });
  };

  // prepare on the first field's focus: solving runs while the visitor types, submit finds a token ready
  return (
    <form>
      <input type="email" onFocus={cap.prepare} />
      {/* … */}
    </form>
  );
}
```

- `cap.prepare()` starts solving in the background, unless a usable token is already there or on its way. `useCap({ eager: false })` turns it into a no-op, so solving happens only on submit.
- `await cap.ensure()` resolves the token for the request, solving if needed. Each token is handed out once, so the next `ensure()` solves again.

Without React, `@astroscope/cap/client` exports the same `createCapSession()` and the lower-level `solveCap()`.

The checkbox widget:

```tsx
import { CapWidget, useCapWidget } from '@astroscope/cap/react';

export function ContactForm() {
  const widget = useCapWidget();

  const onSubmit = async (input: Input) => {
    if (!widget.token) return;

    const { error } = await actions.contact({ ...input, _cap: widget.token });

    // a verified token is consumed server-side, so an error needs a fresh solve
    if (error) widget.reset();
  };

  return (
    <form>
      {/* … */}
      <CapWidget cap={widget} required labels={{ initialState: 'Ich bin kein Roboter' }} />
    </form>
  );
}
```

`CapWidget` props: `labels` (the widget's texts, camelCase keys of the `data-cap-i18n-*` attributes), `lang`, `required` (unsolved blocks the form's native submit), `workers`, `troubleshootingUrl`, `className`, `style` (`--cap-*` custom properties theme the widget through its shadow root). The widget writes the token into a hidden `_cap` field as well, so a plain `<form method="POST">` to a guarded page or endpoint carries it without any script of yours. It renders empty until the cap client has loaded, so reserve its height (58px).

Hand-written widgets outside React: `registerCapWidget()` from `@astroscope/cap/client` loads the client once, pointed at the bundled solvers; `CAP_API_ENDPOINT` and `CAP_FIELD_NAME` fill `data-cap-api-endpoint` and `data-cap-hidden-field-name`.

### Rejections

| Situation                                           | RPC action                                     | Form action                                          | Endpoint / page |
| --------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- | --------------- |
| no `_cap` in the request                            | `ActionError` `BAD_REQUEST` (input validation) | the page renders with the validation error           | `400`           |
| token rejected (`success: false` or a 4xx from Cap) | `ActionError` `FORBIDDEN`                      | the page renders with the error as the action result | `403`           |
| Cap unreachable, 5xx, wrong credentials or not configured | `ActionError` `SERVICE_UNAVAILABLE`            | same, `SERVICE_UNAVAILABLE`                          | `503`           |

Endpoints and pages answer per the request: `{ error: { code, message } }` for an api caller, a plain status page for a browser navigation. A token is verified once per request, however many `captcha()` guards see it.

## Notes

- **Logging**: rejected tokens log at `info`, an unreachable or misconfigured Cap service at `error`.
- **No third-party requests**: the wasm solvers and the pako fallback are served from your origin, nothing is fetched from a CDN, and the widget's credits link opens without the page url or a referrer. Browsers without WebAssembly or Web Workers can't solve.
- **Privacy policy**: two first-party processings to name — the visitor's IP is forwarded to your Cap service for rate limiting, and Cap's instrumentation step runs a bot-detection script from your service in a sandboxed iframe and sends its browser signals back to it.
- **Content Security Policy**: the solver needs `worker-src blob:` and `'wasm-unsafe-eval'`, and Cap's instrumentation step runs an inline script in a sandboxed `srcdoc` iframe (`window.CAP_SCRIPT_NONCE` passes a nonce through).

## License

MIT
