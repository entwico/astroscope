// the destinations the unit tests speak of; not reachable from any entry, so never part of the build

import type { ConsentAnswer, ConsentSource } from './shared.js';

/** a consent source over the test names: every name allowed unless `of` says otherwise */
export function testConsent<N extends string>(
  names: readonly N[],
  of: (name: N) => ConsentAnswer = () => true,
  free: readonly N[] = [],
): ConsentSource<N> {
  return { names, of, free };
}

declare module './shared.js' {
  interface RelayDestinations {
    a: string;
    b: string;
    c: string;
    free: string;
  }
}
