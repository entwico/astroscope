import type { AstroIntegration } from 'astro';
import type { Plugin } from 'vite';

import { ssrSourcemapPlugin } from './plugins/sourcemap.js';
import { stripSsrEffectsPlugin } from './plugins/strip-effects.js';
import type { TweaksOptions } from './types.js';

export default function tweaks(options: TweaksOptions = {}): AstroIntegration {
  const { ssrSourcemaps = true, ssrStripReactEffects = true } = options;

  return {
    name: '@astroscope/tweaks',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        const plugins: Plugin[] = [];

        if (ssrSourcemaps) plugins.push(ssrSourcemapPlugin());
        if (ssrStripReactEffects) plugins.push(stripSsrEffectsPlugin());

        if (plugins.length === 0) return;

        updateConfig({ vite: { plugins } });
      },
    },
  };
}
