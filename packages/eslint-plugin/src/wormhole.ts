import type { ESLint, Linter } from 'eslint';
import { noUseWormholeInAstro } from './rules/wormhole/no-use-wormhole-in-astro.js';
import { serverReadonly } from './rules/wormhole/server-readonly.js';
import { wormholesStaticAccess } from './rules/wormhole/wormholes-static-access.js';

/**
 * Wormhole rules keep their own plugin namespace (`@astroscope/wormhole`), same
 * as the i18n rule set — opt-in alongside `recommended` for projects using
 * `@astroscope/wormhole`.
 */
export const wormholePlugin: ESLint.Plugin = {
  meta: {
    name: '@astroscope/eslint-plugin/wormhole',
  },
  rules: {
    'wormholes-static-access': wormholesStaticAccess,
    'server-readonly': serverReadonly,
    'no-use-wormhole-in-astro': noUseWormholeInAstro,
  },
};

export const wormholeConfigs: Linter.Config[] = [
  {
    name: '@astroscope/wormhole',
    plugins: {
      '@astroscope/wormhole': wormholePlugin,
    },
    rules: {
      '@astroscope/wormhole/wormholes-static-access': 'warn',
      '@astroscope/wormhole/server-readonly': 'error',
      '@astroscope/wormhole/no-use-wormhole-in-astro': 'error',
    },
  },
];
