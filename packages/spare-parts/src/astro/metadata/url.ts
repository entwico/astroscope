/** Prefix a root-relative path (`/x`) with the origin; pass absolute URLs and `undefined` through. */
export function toAbsolute(value: string | undefined, origin: string): string | undefined {
  return value?.startsWith('/') ? origin + value : value;
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
