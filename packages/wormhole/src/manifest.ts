import { manifest } from 'virtual:@astroscope/wormhole/manifest';
import type { WormholeManifest } from './extraction/types.js';

/** null in dev and when the build produced no manifest (broken deploy → full delivery fallback) */
export function getWormholeManifest(): WormholeManifest | null {
  return manifest;
}
