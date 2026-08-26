declare module 'virtual:@astroscope/wormhole/manifest' {
  import type { WormholeManifest } from './extraction/types.js';
  export const manifest: WormholeManifest | null;
}

declare module 'virtual:@astroscope/wormhole/registry' {
  import type { Wormhole } from './types.js';
  export const wormholes: Record<string, Wormhole<unknown>>;
}
