import { useSyncExternalStore } from 'react';
import type { DeepReadonly, Wormhole } from '../types.js';

export function useWormhole<T>(wormhole: Wormhole<T>): DeepReadonly<T> {
  return useSyncExternalStore(wormhole.subscribe, wormhole.get, wormhole.get);
}
