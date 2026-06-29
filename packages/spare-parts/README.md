# @astroscope/spare-parts

> **Note:** This package is in active development. APIs may change between versions.

Reusable Astro components for common client needs.

## Installation

```bash
npm install @astroscope/spare-parts
```

## Parts

| Part               | What it does                                                                            |
| ------------------ | --------------------------------------------------------------------------------------- |
| `Page`             | Full page document — skeleton, head metadata, font preloads, bfcache opt-out, slots     |
| `PreloadFont`      | `<link rel="preload" as="font">` for one font (`Page` maps an array of these)           |
| `JsonScript`       | Render data into an inline JSON `<script>` block without `</script>` breakout           |
| `JsonLd`           | A schema.org JSON-LD block (`JsonScript` with the `@context` / `@graph` envelope)       |
| `Seo`              | `<title>`, description, robots, canonical, hreflang alternates                          |
| `OpenGraph`        | `og:*` and `twitter:*` tags (social sharing, not SEO)                                   |
| `PageMetadata`     | Composes `Seo` + `OpenGraph` into the full head metadata, with URL absolutization       |
| `WithNoBfCache`    | Wrapper that opts a document out of the back-forward cache (header + `pageshow` reload) |
| `SmoothHashScroll` | Smooth-scroll same-page hash links instead of jumping                                   |

All components are imported from the `/astro` entry:

```ts
import { Seo, JsonLd, JsonScript, WithNoBfCache, SmoothHashScroll } from '@astroscope/spare-parts/astro';
```

## Usage

### `<Page>` — the document wrapper

The full page document: it owns the `<html>`/`<head>`/`<body>` structure, `charset`, `viewport`,
font preloads, the head metadata (`<PageMetadata>`, its fields inlined into the props so
`title`/`siteName` are required), and an optional back-forward-cache opt-out (`disableBfCache`).
Everything else project-specific (favicons, consent/analytics, i18n scripts, schema) goes through
the `head` slot and the body, so `<Page>` composes the other parts rather than reimplementing them.

```astro
---
import { Page } from '@astroscope/spare-parts/astro';
import type { WebpageMetadata } from '@astroscope/spare-parts';
import poppins400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2';
import poppins600 from '@fontsource/poppins/files/poppins-latin-600-normal.woff2';

const metadata: WebpageMetadata = { title: 'Home', description: '…', canonical: Astro.originPathname };
---

<Page lang="de" siteName="example.com" bodyClass="font-poppins" fonts={[poppins400, poppins600]} {...metadata}>
  <!-- head-early: earliest in <head>, right after charset -->
  <link slot="head-early" rel="preconnect" href="https://cdn.example.com" />

  <!-- head: the rest of your head tags -->
  <Fragment slot="head">
    <link rel="icon" href="/favicon.svg" />
    <!-- your I18nScript, consent script, extra tags, etc. -->
  </Fragment>

  <!-- default slot: page body -->
  <slot />
</Page>
```

Props: `lang` (required), `htmlClass` (on `<html>`), `bodyClass` (on `<body>`), `fonts`
(`(string | { url, type })[]`), plus all `PageMetadataProps` fields inlined (`title`, `siteName`,
`description`, `og*`, …) — spread your `WebpageMetadata` and add `siteName`. Slots: `head-early`
(right after `<meta charset>` — for `preconnect`/`dns-prefetch` or `<base>`), `head` (the rest of
your head tags), and the default body slot. Pass `disableBfCache` to opt the page out of the
back-forward cache (checkout / auth pages) — `Page` sets the header in time from its own
frontmatter, so no wrapper is needed.

### `<PreloadFont>` — preload one font file

```astro
---
import { PreloadFont } from '@astroscope/spare-parts/astro';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2';
---

<PreloadFont url={inter400} />
<PreloadFont url="/fonts/old.woff" type="font/woff" />
```

Emits `<link rel="preload" href as="font" type="font/woff2" crossorigin>` for one font; `type`
defaults to woff2. `<Page fonts={…}>` maps over `(string | { url, type })[]` to render these
for you — use `<PreloadFont>` directly only when you keep your own skeleton.

### `<PageMetadata>` — the whole head metadata layer

Composes `<Seo>` (real SEO: title/description/robots/canonical/hreflang) and `<OpenGraph>`
(social: `og:*` + `twitter:*`) and absolutizes URLs for you.

```astro
---
import { PageMetadata } from '@astroscope/spare-parts/astro';
import type { WebpageMetadata } from '@astroscope/spare-parts';

// map your CMS / route data into WebpageMetadata once …
const metadata: WebpageMetadata = {
  title: 'Order Summary',
  description: 'Review your order before checkout.',
  index: true,
  canonical: Astro.originPathname,
  ogImage: '/og/checkout.png',
};
---

<head>
  <meta charset="utf-8" />
  <PageMetadata siteName="example.com" {...metadata} />
</head>
```

`<PageMetadata>` emits title, description, `robots`, an absolutized `<link rel="canonical">` (only when `index`), the full `og:*` set **including `og:url`**, a `twitter:card`, and `<link rel="alternate" hreflang>` for every `alternates` entry. Relative `canonical` / `ogImage` values are absolutized against `Astro.url.origin` (override with `origin` when SSR runs behind a proxy).

Everything `<PageMetadata>` renders belongs in `<head>`. JSON-LD is intentionally **not** included — it's valid in `<head>` or at the end of `<body>`, so place `<JsonLd>` separately wherever you prefer.

Need only a piece? Use `<Seo>` (search metadata) or `<OpenGraph>` (social) directly — each resolves its own URLs (canonical / `og:url` absolutization), so they work standalone. `<PageMetadata>` is just a distributor that splits the props across the two.

### `<JsonLd>` — safe schema.org

```astro
---
import { JsonLd } from '@astroscope/spare-parts/astro';
// optional: type your schema.org objects with schema-dts on your side (`npm i -D schema-dts`)
import type { Organization } from 'schema-dts';

const org: Organization = { '@type': 'Organization', name: 'Example', url: 'https://example.com' };
---

<JsonLd content={org} />
```

Pass one object or an array — they're wrapped in `{ "@context": "https://schema.org", "@graph": [...] }`. `content` is typed `unknown`, so the package adds no dependency; bring [`schema-dts`](https://github.com/google/schema-dts) yourself if you want typed builders.

### `<JsonScript>` — any inline JSON data block

```astro
---
import { JsonScript } from '@astroscope/spare-parts/astro';
---

<JsonScript type="application/json" id="bootstrap" data={{ featureFlags: { beta: true } }} />
```

The data is `JSON.stringify`'d and every `<` is escaped to `<`, so a value containing `</script>` cannot break out of the tag. The browser still parses it back to the exact original.

`type` defaults to `application/json`. Use it for any non-executable JSON data block the browser reads but never runs — a client-side script reads it via `JSON.parse(el.textContent)`:

- **hydration / state islands** (the `__NEXT_DATA__` pattern — server state for the client)
- **speculation rules** (`type="speculationrules"`)
- **import maps** (`type="importmap"`)
- **config for a web component or widget**

`<JsonLd>` is just `<JsonScript>` with `type="application/ld+json"` and the schema.org envelope.

### `<WithNoBfCache>` — for checkout / auth pages

Using `<Page>`? Just pass `disableBfCache` instead — it does the same thing without a wrapper. This
standalone wrapper is for when you keep your own skeleton. Wrap your **top-level layout / document**
so a back-button navigation re-fetches the page instead of restoring a stale snapshot (old cart
totals, expired sessions):

```astro
---
import { WithNoBfCache } from '@astroscope/spare-parts/astro';
---

<WithNoBfCache>
  <html lang="en">
    <head><slot name="head" /></head>
    <body><slot /></body>
  </html>
</WithNoBfCache>
```

It sets a `Cache-Control: no-store` response header **and** registers `pageshow`/`pagehide` handlers.

### `<SmoothHashScroll>`

```astro
---
import { SmoothHashScroll } from '@astroscope/spare-parts/astro';
---

<SmoothHashScroll />
```

Delegates a single click listener that smooth-scrolls same-page `#anchor` links.

## License

MIT
