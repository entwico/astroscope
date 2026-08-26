import type { LocalImageService } from 'astro';

const MESSAGE =
  "[@astroscope/node] image processing is disabled: astro's on-demand `/_image` endpoint is a decode+encode " +
  'amplification surface, so the adapter turns it off unless a service is configured. Serve pre-generated ' +
  "variants with a plain <img>, or opt in via the adapter option `imageService: 'on'` (astro's sharp service) " +
  'or an explicit `image.service` in the astro config.';

function disabled(): never {
  throw new Error(MESSAGE);
}

/**
 * The service injected for `imageService: 'off'` (and `'auto'` without a
 * configured `image.service`). Any `astro:assets` use — `<Image>`,
 * `<Picture>`, `getImage()`, markdown or content-collection images — throws
 * the explanation above at render/build time, so disabled processing fails
 * loudly instead of silently serving unoptimized bytes. `/_image` itself is
 * replaced by the 404 endpoint in `endpoint-disabled.ts`. The module is only
 * ever imported on first `astro:assets` use.
 */
const service: LocalImageService = {
  propertiesToHash: ['src'],
  validateOptions: disabled,
  getHTMLAttributes: disabled,
  getSrcSet: disabled,
  getURL: disabled,
  getRemoteSize: disabled,
  parseURL: () => undefined,
  transform: disabled,
};

export default service;
