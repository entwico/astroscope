import { fileURLToPath } from 'node:url';
import astroReact, { type ReactIntegrationOptions } from '@astrojs/react';
import type { AstroIntegration, AstroRenderer } from 'astro';
import { version as reactDomVersion } from 'react-dom';
import { stripSsrEffectsPlugin } from './strip-effects.js';

export type ReactOptions = Omit<
  ReactIntegrationOptions,
  'experimentalReactChildren' | 'experimentalDisableStreaming'
> & {
  /**
   * Empty `useEffect`/`useLayoutEffect`/`useInsertionEffect` callbacks in the SSR
   * bundle so client-only dynamic imports drop out of the server build.
   * @default true
   */
  stripEffects?: boolean;
};

const UPSTREAM_SERVER_ENTRYPOINT = '@astrojs/react/server.js';
const UPSTREAM_CLIENT_ENTRYPOINT = '@astrojs/react/client.js';
const SERVER_ENTRYPOINT = '@astroscope/react/server';

/**
 * `@astrojs/react` with the server renderer swapped for `@astroscope/react/server`:
 * every hook is delegated to the upstream integration, only the renderer it
 * registers gets our `serverEntrypoint`. The client entrypoint stays upstream's,
 * aliased to the pinned copy: `@astrojs/react` is our dependency, not the
 * project's, so vite could not resolve it from the project root otherwise.
 */
export default function react(options: ReactOptions = {}): AstroIntegration {
  const { stripEffects = true, ...upstreamOptions } = options;
  const major = Number(/^\d+/.exec(reactDomVersion)?.[0]);

  if (!(major >= 19)) {
    throw new Error(`[@astroscope/react] unsupported react-dom version ${reactDomVersion}, 19+ required`);
  }

  const upstream = astroReact(upstreamOptions);

  return {
    name: '@astroscope/react',
    hooks: {
      ...upstream.hooks,
      'astro:config:setup': async (params) => {
        await upstream.hooks['astro:config:setup']?.({
          ...params,
          addRenderer: (renderer) => params.addRenderer(replaceServerEntrypoint(renderer)),
        });

        params.updateConfig({
          vite: {
            resolve: {
              alias: { [UPSTREAM_CLIENT_ENTRYPOINT]: fileURLToPath(import.meta.resolve(UPSTREAM_CLIENT_ENTRYPOINT)) },
            },
            ...(stripEffects && { plugins: [stripSsrEffectsPlugin()] }),
          },
        });
      },
    },
  };
}

function replaceServerEntrypoint(renderer: AstroRenderer): AstroRenderer {
  if (renderer.serverEntrypoint !== UPSTREAM_SERVER_ENTRYPOINT) {
    throw new Error(
      `[@astroscope/react] unexpected @astrojs/react server entrypoint ${String(renderer.serverEntrypoint)}`,
    );
  }

  return { ...renderer, serverEntrypoint: SERVER_ENTRYPOINT };
}
