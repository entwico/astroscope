/**
 * Per-process generation state shared between the integration's connect-level
 * stamp and the runtime Astro middleware.
 */

export const GEN_HEADER = 'x-astroscope-boot-gen';

const STATE_KEY = Symbol.for('@astroscope/boot/state');

interface State {
  generation: number;
  staleCount: number;
  flushTimer: ReturnType<typeof setTimeout> | undefined;
}

function getState(): State {
  const g = globalThis as Record<symbol, unknown>;
  let s = g[STATE_KEY] as State | undefined;

  if (!s) {
    s = { generation: 0, staleCount: 0, flushTimer: undefined };
    g[STATE_KEY] = s;
  }

  return s;
}

export function getCurrentGeneration(): number {
  return getState().generation;
}

export function incrementGeneration(): void {
  getState().generation++;
}

/**
 * Buffer a swallowed stale-request error and flush a single concise line per
 * burst — replaces the multi-line stack traces astro otherwise emits.
 */
export function recordStaleError(): void {
  const s = getState();

  s.staleCount++;

  if (s.flushTimer) return;

  s.flushTimer = setTimeout(() => {
    const n = s.staleCount;

    s.staleCount = 0;
    s.flushTimer = undefined;

    console.log(
      `[@astroscope/boot] suppressed ${n} stale request error${n === 1 ? '' : 's'} from a previous app generation`,
    );
  }, 50);
}
