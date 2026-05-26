export interface TweaksOptions {
  /**
   * Emit sourcemaps for the SSR build only. The client bundle is left unmapped
   *
   * @default true
   */
  ssrSourcemaps?: boolean;

  /**
   * In the SSR pass, strip `useEffect`, `useLayoutEffect` and `useInsertionEffect`
   * callbacks with an empty function. React effects do not run in SSR, saves bundle and cold start time
   *
   * First-party code only; node_modules are untouched. Binding-aware: the
   * React import must resolve before any replacement happens.
   *
   * @default true
   */
  ssrStripReactEffects?: boolean;
}
