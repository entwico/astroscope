export interface RobotsOptions {
  index?: boolean | undefined;
  follow?: boolean | undefined;
  /** A `Date` or date string; normalized to ISO 8601 (UTC). Unparseable values are ignored. */
  unavailableAfter?: Date | string | undefined;
}

// normalize to a comma-free ISO 8601 string. accepting a Date (or any parseable string) lets
// us guarantee the value can't corrupt the comma-joined `robots` content — RFC 850/822 dates
// contain commas, ISO does not. unparseable input returns undefined so the directive is skipped.
function toIsoDate(value: Date | string): string | undefined {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Compute the `robots` meta directives for a page.
 *
 * Returns an empty array for the permissive default (`index, follow` with no expiry) so the
 * caller can omit the tag entirely — rendering `index, follow` is the engine default and
 * therefore noise. Positive defaults are never emitted: `noindex` alone implies `follow`,
 * `nofollow` alone implies `index`.
 */
export function computeRobots({ index = true, follow = true, unavailableAfter }: RobotsOptions): string[] {
  const robots: string[] = [];

  if (!index) {
    robots.push('noindex');
  }

  if (!follow) {
    robots.push('nofollow');
  }

  // `unavailable_after` only applies to an indexable page
  if (index && unavailableAfter) {
    const iso = toIsoDate(unavailableAfter);

    if (iso) {
      robots.push(`unavailable_after: ${iso}`);
    }
  }

  return robots;
}
