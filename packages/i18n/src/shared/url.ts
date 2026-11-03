/**
 * Convert a Vite chunk ID to a clean chunk name
 * Strips the _astro/ prefix that Vite adds
 *
 * @example
 * chunkIdToName('_astro/Cart.C_sxtxbl') // → 'Cart.C_sxtxbl'
 * chunkIdToName('Cart.C_sxtxbl') // → 'Cart.C_sxtxbl'
 */
export function chunkIdToName(chunkId: string): string {
  return chunkId.replace(/^_astro\//, '');
}

/**
 * Extract chunk name from a component URL
 * Used by client directives to get the hash lookup key
 *
 * @example
 * componentUrlToChunkName('/_astro/Cart.C_sxtxbl.js') // → 'Cart.C_sxtxbl'
 */
export function componentUrlToChunkName(componentUrl: string): string {
  return componentUrl.replace(/^\/_astro\//, '').replace(/\.js$/, '');
}

/** the chunk endpoint's path under the site's base */
export const I18N_CHUNK_PATH = '/_i18n/';

/**
 * The url prefix of the chunk endpoint for a site's astro `base`: the chunks live
 * under the base like astro's own `/_astro/` assets and `/_image` endpoint, so a
 * proxy routing only the base path to the site still reaches them.
 *
 * @example
 * chunkPrefixFor('/') // → '/_i18n/'
 * chunkPrefixFor('/docs/') // → '/docs/_i18n/'
 */
export function chunkPrefixFor(base: string): string {
  const path = base.replaceAll(/^\/+|\/+$/g, '');

  return path === '' ? I18N_CHUNK_PATH : `/${path}${I18N_CHUNK_PATH}`;
}

/**
 * Build the URL path for fetching a translation chunk
 *
 * @example
 * buildI18nChunkUrl('en', '_astro/Cart.C_sxtxbl', 'bzh6rx')
 * // → '/_i18n/en/Cart.C_sxtxbl.bzh6rx.js'
 */
export function buildI18nChunkUrl(locale: string, chunkId: string, hash: string, prefix = I18N_CHUNK_PATH): string {
  return `${prefix}${locale}/${chunkIdToName(chunkId)}.${hash}.js`;
}
