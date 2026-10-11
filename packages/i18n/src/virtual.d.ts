declare module 'virtual:@astroscope/i18n/manifest' {
  import type { ExtractionManifest } from './extraction/types.js';
  export const manifest: ExtractionManifest;
  export function getManifest(): ExtractionManifest;
}

declare module 'virtual:@astroscope/i18n/config' {
  import type { ExcludePattern } from '@astroscope/node/excludes';
  export const exclude: ExcludePattern[] | null;
}
