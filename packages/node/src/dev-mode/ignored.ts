export const ignoredSuffixes = [
  // type definitions
  '.d.ts',
  '.d.mts',
  '.d.cts',
  // images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
  '.ico',
  // fonts
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  // other static assets
  '.pdf',
  '.mp3',
  '.mp4',
  '.webm',
  '.ogg',
  '.wav',
  // data/config that boot typically doesn't import
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.md',
  '.mdx',
  '.txt',
  // styles (handled by Vite's CSS HMR)
  '.css',
  '.scss',
  '.sass',
  '.less',
];
