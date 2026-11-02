import { useEffectOnce } from '@entwico/dash/react';
import { track } from '../client/track.js';
import type { TrackInput } from '../shared.js';

export type TrackProps = {
  event: TrackInput;
};

/** tracks the event once, when the island mounts; renders nothing */
export function Track({ event }: TrackProps) {
  useEffectOnce(() => {
    track(event);
  });

  return null;
}
