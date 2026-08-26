/** the shared key format for a wormhole's ALS entry — kept free of node imports for the browser build */
export function wormholeKey(name: string): string {
  return `__wormhole_${name}__`;
}
