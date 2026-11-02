import type { TrackInput } from './shared.js';

/**
 * The body of an inline script that tracks an event from hand-written html, before or after the
 * bus is installed; `<Track>` is the same thing as an Astro component.
 */
export function inlineTrack(input: TrackInput): string {
  // `<` is escaped so the json can never close the script tag it is written into
  const json = JSON.stringify(input).replaceAll('<', String.raw`\u003c`);

  return `(self.__relay__??={q:[]}).q.push(${json});`;
}
