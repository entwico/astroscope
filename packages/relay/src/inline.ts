import type { TrackInput } from './shared.js';

/**
 * The script the integration puts into every page head: the queue the inline calls land in until
 * the bus is installed, which takes its place and drains it.
 */
export const RELAY_QUEUE_SCRIPT = 'self.__relay__??={q:[],track(e){this.q.push(e)}};';

/**
 * The body of an inline script, or of an `onclick` handler, that tracks an event from
 * server-rendered html, before or after the bus is installed; `<Track>` is the same thing as an
 * Astro component. A handler attribute is what sanitizers strip, so content can never carry one.
 */
export function inlineTrack(input: TrackInput): string {
  // `<` is escaped so the json can never close the script tag it is written into
  const json = JSON.stringify(input).replaceAll('<', String.raw`\u003c`);

  return `__relay__.track(${json});`;
}
