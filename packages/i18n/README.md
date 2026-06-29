# @astroscope/i18n

> **Note:** This package is in active development. APIs may change between versions.

i18n for Astro + React islands — automatic tree-shaking, parallel loading, any translation source.

## Why this library?

**SSR-first** — Built for Astro's SSR + islands architecture, where client-only i18n libraries have no server story.

**Automatic tree-shaking** — Only the translations each component actually uses are delivered to the browser. No manual chunk splitting or configuration.

**Parallel loading** — Translations load alongside component hydration via custom `client:*-x` directives, so hydration doesn't wait on a separate translation fetch.

**Unified API** — The same `t()` function works in Astro templates and React islands.

**Any translation source** — Fetch translations from any provider: JSON files, database, headless CMS, TMS, or custom API. All are chunked and optimized the same way.

**Production optimized** — Fallback strings are stripped from production bundles via Babel and kept available through the manifest.

## Features

- **Per-chunk translation loading** — each island gets only its translations
- **Unicode MessageFormat 2** (MF2) support via `messageformat` v4
- **Built-in formatters** — `:number`, `:integer`, `:percent`, `:currency`, `:date`, `:time`, `:datetime`, `:unit`
- **Babel-based extraction** — AST parsing, source maps, production stripping
- **Manifest fallbacks** — missing translations automatically use extracted fallbacks
- **Full TypeScript support**
- **Tiny client runtime** — ~8KB gzipped for translations

## Installation

```bash
npm install @astroscope/i18n @astroscope/boot @astroscope/excludes
```

## Usage

### 1. Add the integration

```ts
// astro.config.ts
import { defineConfig } from 'astro/config';
import boot from '@astroscope/boot';
import i18n from '@astroscope/i18n';

export default defineConfig({
  integrations: [
    boot(),
    i18n(),
  ],
});
```

#### Consistency checking

The integration checks for translation key consistency — when the same key is used in multiple files with different fallbacks, variables, or descriptions.

```ts
i18n({
  consistency: 'error',  // 'error' (default) | 'warn' | 'off'
})
```

- **`'error'`** — Fail the build (default)
- **`'warn'`** — Log a warning but continue
- **`'off'`** — Disable consistency checking

### 2. Configure i18n in your boot file

> **Note:** `i18n.configure` must be awaited during boot, before any requests are handled.

```ts
// src/boot.ts
import { i18n, type RawTranslations } from '@astroscope/i18n';

async function fetchTranslations(locale: string): Promise<RawTranslations> {
  // fetch from your CMS, API, or local files
  const response = await fetch(`https://api.example.com/translations/${locale}`);
  return response.json();
}

export async function onStartup() {
  await i18n.configure({
    locales: ['en', 'de'],
    defaultLocale: 'en',  // optional, defaults to first locale
  });

  // load translations for all locales
  const [en, de] = await Promise.all([
    fetchTranslations('en'),
    fetchTranslations('de'),
  ]);

  i18n.setTranslations('en', en);
  i18n.setTranslations('de', de);
}
```

### 3. Add the middleware

```ts
// src/middleware.ts
import { sequence } from 'astro:middleware';
import { createI18nChunkMiddleware, createI18nMiddleware, i18n } from '@astroscope/i18n';

export const onRequest = sequence(
  createI18nChunkMiddleware(),  // serves /_i18n/ translation chunks
  createI18nMiddleware({
    locale: (ctx) =>
      ctx.cookies.get('locale')?.value ??
      i18n.getConfig().defaultLocale,
  }),
);
```

By default, `RECOMMENDED_EXCLUDES` (static assets like `/_astro/`) are excluded from locale context setup. To customize:

```ts
import { sequence } from 'astro:middleware';
import { createI18nChunkMiddleware, createI18nMiddleware, i18n } from '@astroscope/i18n';
import { RECOMMENDED_EXCLUDES } from '@astroscope/excludes';

export const onRequest = sequence(
  createI18nChunkMiddleware(),
  createI18nMiddleware({
    locale: (ctx) =>
      ctx.cookies.get('locale')?.value ??
      i18n.getConfig().defaultLocale,
    exclude: [...RECOMMENDED_EXCLUDES, { exact: '/health' }],
  }),
);
```

### 4. Add `<I18nScript />` to your layout

Inject translations into the page for hydrated components:

```astro
---
import { I18nScript } from '@astroscope/i18n/astro';
---
<html>
  <head>
    <I18nScript />
  </head>
  <body>
    <slot />
  </body>
</html>
```

### 5. Use `t()` in your components

```astro
---
// In .astro files
import { t } from '@astroscope/i18n/translate';
---
<h1>{t('checkout.title', 'Order Summary')}</h1>
```

```tsx
// In React components
import { t } from '@astroscope/i18n/translate';

export function CheckoutSummary() {
  return (
    <div>
      <h1>{t('checkout.title', 'Order Summary')}</h1>
      <p>{t('checkout.tax', 'Includes {$tax} VAT', { tax: '19%' })}</p>
    </div>
  );
}
```

> **Note:** Variables use `{$name}` syntax (with `$` prefix) per MessageFormat 2 specification.

### 6. Use i18n-aware client directives

**The problem:** With standard `client:*` directives, the translation chunk loads *after* the component module. This delays hydration while translations are fetched sequentially.

**The solution:** Use `client:*-x` directives to load translations in parallel with the component code:

```astro
---
import Cart from '../components/Cart';
---
<!-- translations load alongside component code -->
<Cart client:load-x />
<Cart client:visible-x />
<Cart client:idle-x />
```

## API

### `t(key, fallback, values?)`

Translate a key with optional interpolation values. The fallback is used when a translation is missing and also serves as an example for translators. Uses [MessageFormat 2](https://github.com/unicode-org/message-format-wg) syntax.

```ts
// simple text
t('checkout.title', 'Order Summary')

// with variables (note the $ prefix)
t('checkout.tax', 'Includes {$tax} VAT', { tax: '19%' })

// with pluralization (MF2 syntax)
t('cart.items', `.input {$count :number}
.match $count
one {{{$count} item}}
* {{{$count} items}}`, { count: 5 })

// with number formatting
t('stats.value', '{$value :number minimumFractionDigits=2}', { value: 1234.5 })

// with percentage
t('stats.ratio', '{$value :percent}', { value: 0.856 })

// with date/time formatting
t('event.date', '{$date :date style=long}', { date: new Date() })
t('event.time', '{$time :time style=short}', { time: new Date() })

// with currency (translator controls currency)
t('product.price', '{$price :currency currency=EUR}', { price: 99.99 })

// with currency (code controls currency via wrapped value)
t('product.price', '{$price :currency}', {
  price: { valueOf: () => 99.99, options: { currency: 'EUR' } }
})

// with units
t('distance', '{$value :unit unit=kilometer}', { value: 42 })

// with metadata object (for extraction tooling)
t('cart.total', {
  example: 'Total: {$amount}',
  description: 'Cart total price',
  variables: {
    amount: { example: '$0.00', description: 'Formatted price' }
  }
}, { amount: '$49.99' })
```

### `rich(key, fallback, components, values?)`

Translate with embedded components using MF2 markup syntax. Returns an array of strings and JSX elements that can be rendered directly.

```tsx
import { rich } from '@astroscope/i18n/translate';

// basic link
rich('tos', 'Read our {#link}Terms of Service{/link}', {
  link: (children) => <a href="/tos">{children}</a>
})
// Returns: ['Read our ', <a href="/tos">Terms of Service</a>]

// multiple tags
rich('legal', 'Read our {#tos}Terms{/tos} and {#privacy}Privacy Policy{/privacy}', {
  tos: (children) => <a href="/tos">{children}</a>,
  privacy: (children) => <a href="/privacy">{children}</a>,
})

// with variables
rich('greeting', 'Hello {$name}, check your {#inbox}messages{/inbox}', {
  inbox: (children) => <a href="/inbox">{children}</a>,
}, { name: 'Alice' })

// nested tags
rich('highlight', 'This is {#bold}very {#em}important{/em}{/bold}', {
  bold: (children) => <strong>{children}</strong>,
  em: (children) => <em>{children}</em>,
})

// standalone (self-closing) tags
rich('install', 'Click {#icon/} to install', {
  icon: () => <DownloadIcon />,
})
```

The same code works in both Astro templates and React islands — `rich()` is JSX-runtime agnostic.

### `i18n` singleton

```ts
import { i18n } from '@astroscope/i18n';

// configure (call once at startup)
await i18n.configure({
  locales: ['en', 'de'],
  defaultLocale: 'en',
});

// set translations for a locale
i18n.setTranslations('en', { 'key': 'value' });

// get raw translations (includes manifest fallbacks)
i18n.getTranslations('en');

// get compiled translations (ICU MessageFormat functions)
i18n.getCompiledTranslations('en');

// get extraction manifest
// has all extracted keys with their metadata
// you can use this to generate translation files or upload to a TMS / CMS
i18n.getManifest();

// clear cached translations
i18n.clear();        // all locales
i18n.clear('en');    // specific locale
```

### Lazy loading with React.lazy()

Translations load automatically for lazy-loaded components.

```tsx
import { Suspense, lazy } from 'react';

const StatsModal = lazy(() => import('./StatsModal'));

export function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StatsModal />
    </Suspense>
  );
}
```

## How it works

1. **Build time** — Babel plugin extracts all `t()` calls, maps them to chunks, strips fallbacks from production bundles
2. **Manifest** — Extracted keys with fallbacks are written to `i18n-manifest.json`
3. **SSR** — Middleware provides translations to `t()`, merging manifest fallbacks for missing keys
4. **Client** — Custom directives load only the translations needed by each chunk

The same `import { t } from '@astroscope/i18n/translate'` works everywhere — bundler picks the correct implementation via conditional exports (`browser` vs `default`).

### Client bundle

Translation chunks are served as raw MessageFormat 2 strings and compiled on the browser on first use. This keeps chunk sizes minimal — the `messageformat` runtime is ~8KB gzipped. Compiled messages are cached for subsequent renders.

> **Future:** Once browsers ship native `Intl.MessageFormat`, this 8KB runtime will be replaced by the built-in API with zero bundle cost.

## MessageFormat 2 Syntax

This library uses [Unicode MessageFormat 2](https://github.com/unicode-org/message-format-wg) (MF2), the modern standard for internationalization.

### Basic syntax

```
Simple text
Hello {$name}
```

### Pluralization

```
.input {$count :number}
.match $count
one {{{$count} item}}
* {{{$count} items}}
```

### Selection (gender, etc.)

```
.input {$gender :string}
.match $gender
male {{He liked it}}
female {{She liked it}}
* {{They liked it}}
```

### Built-in formatters

| Formatter | Description | Example |
|-----------|-------------|---------|
| `:number` | Locale-aware number | `{$n :number}` → "1,234.56" |
| `:integer` | Integer (no decimals) | `{$n :integer}` → "1,235" |
| `:percent` | Percentage | `{$n :percent}` → "85.6%" |
| `:currency` | Currency | `{$n :currency currency=EUR}` → "€99.99" |
| `:date` | Date | `{$d :date style=long}` → "January 26, 2026" |
| `:time` | Time | `{$d :time style=short}` → "3:45 PM" |
| `:datetime` | Date + time | `{$d :datetime dateStyle=medium timeStyle=short}` |
| `:unit` | Units | `{$n :unit unit=kilometer}` → "42 km" |

### Currency and unit options

For `:currency` and `:unit`, the required option (`currency` or `unit`) can be:

1. **Hardcoded in translation** (translator controls):
   ```
   {$price :currency currency=EUR}
   ```
   Code passes plain number: `{ price: 99.99 }`

2. **Provided by code** (for dynamic currency/unit):
   ```
   {$price :currency}
   ```
   Code passes wrapped value: `{ price: { valueOf: () => 99.99, options: { currency: 'EUR' } } }`

> **Note:** If both translation and code specify the option, **translation wins**.

## Configuration

### i18n.configure()

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `locales` | `string[]` | required | Supported locales |
| `defaultLocale` | `string` | first locale | Default/fallback locale |
| `fallback` | `FallbackBehavior` | `'fallback'` | Behavior when translation missing |

### FallbackBehavior

- `'fallback'` — Use the fallback string from manifest (default)
- `'key'` — Return the translation key
- `'throw'` — Throw an error
- `(key, meta) => string` — Custom function

## ESLint Plugin

Use [`@astroscope/eslint-plugin-i18n`](../eslint-plugin-i18n) to enforce correct `t()` usage, catch build-time extraction issues, and ensure i18n-aware hydration directives.

```bash
npm install -D @astroscope/eslint-plugin-i18n
```

```js
// eslint.config.js
import i18n from '@astroscope/eslint-plugin-i18n';

export default [
  i18n.configs.recommended,
];
```

## License

MIT
