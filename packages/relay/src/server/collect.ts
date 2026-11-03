import { type Collect, createCollect } from '../collect.js';
import { getRelayContext, runWithRelayContext } from './context.js';

/**
 * Folds single sightings into batched events: a list is seen one item at a time as the rows enter
 * the viewport, while `view_item_list` is one event with the items. The collector keeps a buffer per
 * key and flushes it after the quiet time, in chunks of at most `max` items. Buffers are shared by
 * every caller of the collector, so sightings with the same key from several components go out as
 * one batch — per request on the server, so a batch never mixes visitors.
 */
export const collect: Collect = createCollect({ current: getRelayContext, run: runWithRelayContext });
