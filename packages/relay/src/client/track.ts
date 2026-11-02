import type { TrackFunction } from '../shared.js';
import { bus } from './instance.js';

/** records that something happened: the event, with the payloads of the destinations it is meant for; returns its id */
export const track: TrackFunction = (input) => bus.track(input);
