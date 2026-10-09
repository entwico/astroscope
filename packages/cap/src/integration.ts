import type { AstroIntegration } from 'astro';
import type { Plugin } from 'vite';
import { DEFAULT_CAP_PATH, normalizeCapPath } from './shared.js';
import type { CapIntegrationOptions } from './types.js';

const VIRTUAL_CONFIG_ID = 'virtual:@astroscope/cap/config';
const RESOLVED_VIRTUAL_CONFIG_ID = `\0${VIRTUAL_CONFIG_ID}`;

/**
 * Astro integration for the Cap captcha: injects the middleware that proxies the challenge and
 * redeem endpoints to the cap service under `path`. Verification happens where the request lands,
 * through the `captcha` guard (`@astroscope/cap/server`). The service credentials are runtime
 * secrets and go through `cap.configure()` in `src/boot.ts`, never through the astro config.
 */
export default function capIntegration(options: CapIntegrationOptions = {}): AstroIntegration {
  const path = normalizeCapPath(options.path ?? DEFAULT_CAP_PATH);

  const configPlugin: Plugin = {
    name: '@astroscope/cap/config',
    resolveId(id) {
      return id === VIRTUAL_CONFIG_ID ? RESOLVED_VIRTUAL_CONFIG_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_CONFIG_ID) return;

      return `export const path = ${JSON.stringify(path)};`;
    },
  };

  return {
    name: '@astroscope/cap',
    hooks: {
      'astro:config:setup': ({ addMiddleware, updateConfig }) => {
        addMiddleware({ order: 'pre', entrypoint: '@astroscope/cap/middleware' });

        updateConfig({ vite: { plugins: [configPlugin] } });
      },
    },
  };
}
