// the unique marker is what the e2e test greps for. with strip-effects, the
// SSR pass empties the useEffect body that imports this module, so rolldown
// has no reference and drops the chunk. result: marker appears only in the
// client bundle.
export const CANARY_MARKER = '__tweaks_canary_marker__';
