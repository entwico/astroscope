export type SeoAlternate = {
  /** Language/region code, e.g. `en`, `de-CH`, or `x-default`. */
  hreflang: string;
  /** Absolute URL of this language/region variant. */
  href: string;
};

/**
 * Framework-agnostic SEO data for a single page. Map your CMS / route data into
 * this shape, then spread it into `<PageMetadata {...metadata} siteName="…" />`.
 */
export type WebpageMetadata = {
  /** The page title: `<title>`. */
  title: string;
  /** Meta description: `<meta name="description">`. */
  description?: string | undefined;
  /** Whether search engines may index the page. Defaults to `true` (no `noindex`). */
  index?: boolean | undefined;
  /** Whether search engines may follow links on the page. Defaults to `true` (no `nofollow`). */
  follow?: boolean | undefined;
  /**
   * Date after which Google drops the page from results (the `unavailable_after` directive).
   * A `Date` or any parseable date string — normalized to ISO 8601 (UTC), so it's comma-safe.
   * Google-only; other engines ignore it.
   */
  unavailableAfter?: Date | string | undefined;
  /** Canonical URL (`<link rel="canonical">`). Relative paths are absolutized; omitted when `noindex`. */
  canonical?: string | undefined;
  /** `hreflang` alternates (`<link rel="alternate">`) for other language/region variants. */
  alternates?: SeoAlternate[] | undefined;
  /** Social share image URL (`og:image` / `twitter:image`). Relative paths are absolutized. */
  ogImage?: string | undefined;
  /** `og:title` override; falls back to `title`. */
  ogTitle?: string | undefined;
  /** `og:description` override; falls back to `description`. */
  ogDescription?: string | undefined;
  /** `og:type`. Defaults to `website`. */
  ogType?: string | undefined;
  /** `twitter:card` type. Defaults to `summary_large_image` when an image is set, else `summary`. */
  twitterCard?: 'summary' | 'summary_large_image' | undefined;
  /** `twitter:site` — the site's `@handle`. */
  twitterSite?: string | undefined;
};

type WithOrigin = {
  /** Origin override for SSR behind a proxy. Defaults to `Astro.url.origin`. */
  origin?: string | undefined;
};

/** Props for `<Seo>` — the search-metadata subset of {@link WebpageMetadata}. */
export type SeoProps = Pick<
  WebpageMetadata,
  'title' | 'description' | 'index' | 'follow' | 'canonical' | 'unavailableAfter' | 'alternates'
> &
  WithOrigin;

/**
 * Props for `<OpenGraph>` — the social-sharing subset of {@link WebpageMetadata} plus the site
 * name. URLs are resolved by the component, so raw (relative) `canonical` / `ogImage` are fine.
 */
export type OpenGraphProps = Pick<
  WebpageMetadata,
  'title' | 'description' | 'ogType' | 'ogImage' | 'canonical' | 'twitterCard' | 'twitterSite'
> &
  WithOrigin & {
    /** Site name (`og:site_name`). */
    siteName: string;
  };

/** Props for `<PageMetadata>` — page metadata plus the site name and an optional origin override. */
export type PageMetadataProps = WebpageMetadata &
  WithOrigin & {
    /** Site name (`og:site_name`). */
    siteName: string;
  };

/** Props for `<PreloadFont>` — a single font to preload. */
export type PreloadFontProps = {
  /** Font file URL. */
  url: string;
  /** `type` attribute (MIME). Defaults to `font/woff2`. */
  type?: string | undefined;
};

/**
 * Props for `<Page>` — the document shell. The page metadata is inlined (not nested), so
 * `title` / `siteName` are required.
 */
export type PageProps = PageMetadataProps & {
  /** `<html lang>`. */
  lang: string;
  /** `<meta charset>` — defaults to `utf-8`. */
  charset?: string | undefined;
  /** `<meta name="viewport">` content — defaults to `width=device-width, initial-scale=1`. */
  viewport?: string | undefined;
  /** Class applied to `<html>`. */
  htmlClass?: string | undefined;
  /** Class applied to `<body>`. */
  bodyClass?: string | undefined;
  /** Fonts to preload — a URL string (woff2) or `{ url, type }` for other formats. */
  fonts?: (string | PreloadFontProps)[] | undefined;
  /** Opt the page out of the back-forward cache (checkout / auth pages). */
  disableBfCache?: boolean | undefined;
};
