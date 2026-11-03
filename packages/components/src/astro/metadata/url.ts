/**
 * Resolve a url against the origin: root-relative (`/x`), protocol-relative (`//cdn/x`) and bare
 * relative (`x`) paths become absolute, absolute urls and `undefined` pass through. A value that is
 * no url at all is returned as given.
 */
export function toAbsolute(value: string | undefined, origin: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return new URL(value, `${origin}/`).href;
  } catch {
    return value;
  }
}

export interface CanonicalInput {
  canonical?: string | undefined;
  origin: string;
  /** The original request path — use `Astro.originPathname`, which is rewrite-safe. */
  pathname: string;
  hasSearchParams: boolean;
}

/**
 * Resolve the absolute canonical URL for a page. When no canonical is given but the URL carries
 * query params, fall back to the bare path so query variations don't read as duplicate content.
 * Returns `undefined` when there's nothing to canonicalize.
 */
export function resolveCanonical({ canonical, origin, pathname, hasSearchParams }: CanonicalInput): string | undefined {
  const value = canonical || (hasSearchParams ? pathname : undefined);

  return toAbsolute(value, origin);
}
