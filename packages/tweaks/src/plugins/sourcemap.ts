import type { Plugin } from 'vite';

/**
 * emit sourcemaps only for the SSR build. client bundles are left unmapped
 * so browsers can't fetch source via `//# sourceMappingURL=`.
 *
 * vite 7's `environments.ssr.build.sourcemap` looks cleaner but wholesale
 * replaces astro's SSR build defaults (including entry file naming), which
 * breaks integrations like @astroscope/boot. using `isSsrBuild` keeps the
 * rest of astro's SSR config intact.
 */
export function ssrSourcemapPlugin(): Plugin {
  return {
    name: '@astroscope/tweaks/sourcemap',
    config(_config, { isSsrBuild }) {
      if (isSsrBuild) return { build: { sourcemap: true } };

      return {};
    },
  };
}
