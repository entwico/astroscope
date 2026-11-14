import { toIsoDate } from './date';

export interface RobotsOptions {
  index?: boolean | undefined;
  follow?: boolean | undefined;
  /** A `Date` or date string; normalized to ISO 8601 (UTC). Unparseable values are ignored. */
  unavailableAfter?: Date | string | undefined;
  maxImagePreview?: 'none' | 'standard' | 'large' | undefined;
}

/**
 * Compute the `robots` meta directives for a page.
 *
 * Returns an empty array for the permissive default (`index, follow` with no expiry) so the
 * caller can omit the tag entirely — rendering `index, follow` is the engine default and
 * therefore noise. Positive defaults are never emitted: `noindex` alone implies `follow`,
 * `nofollow` alone implies `index`.
 */
export function computeRobots(options: RobotsOptions): string[] {
  const { index = true, follow = true, unavailableAfter, maxImagePreview } = options;
  const robots: string[] = [];

  if (!index) {
    robots.push('noindex');
  }

  if (!follow) {
    robots.push('nofollow');
  }

  // preview limits and `unavailable_after` only apply to an indexable page
  if (index && maxImagePreview) {
    robots.push(`max-image-preview:${maxImagePreview}`);
  }

  // normalized to ISO 8601, which is comma-free: RFC 850/822 dates would corrupt the comma-joined content
  if (index && unavailableAfter) {
    const iso = toIsoDate(unavailableAfter);

    if (iso) {
      robots.push(`unavailable_after: ${iso}`);
    }
  }

  return robots;
}
