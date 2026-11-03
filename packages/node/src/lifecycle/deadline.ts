import { log } from '../observability/log/index.js';

/**
 * Waits for a shutdown phase at most `timeoutMs`: a hanging phase — a database
 * close that never answers, a telemetry flush against a dead collector — would
 * otherwise keep the process alive until the orchestrator kills it, with no
 * line in the log saying why. The phase is left running; the caller exits.
 */
export async function withShutdownDeadline(phase: string, run: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  try {
    const outcome = await Promise.race([run(), deadline]);

    if (outcome === 'timeout') {
      log.error({ phase, timeoutMs }, 'shutdown phase timed out, exiting anyway');
    }
  } finally {
    clearTimeout(timer);
  }
}
