import astroscope, { i18nPlugin, wormholePlugin } from '@astroscope/eslint-plugin';
import { JS_TS_FILES, defineConfig } from '@entwico/eslint-config';

const rulesOf = (configs) => Object.assign({}, ...configs.map((config) => config.rules ?? {}));
const within = (dir) => JS_TS_FILES.map((glob) => `${dir}/${glob}`);

export default defineConfig({
  root: import.meta.dirname,
  astro: true,
  react: true,
  imports: {
    // re-exports belong in package entry points only: `.` and the sub-path exports (see each tsdown.config.ts)
    noReexport: {
      allow: [
        'packages/*/src/index.ts',
        'packages/*/src/**/index.{ts,tsx}',
        'packages/cap/src/server.ts',
        'packages/i18n/src/internal.ts',
        'packages/node/src/lifecycle/boot.ts',
        'packages/wormhole/src/index.browser.ts',
      ],
    },
  },
  extra: [
    // the i18n and wormhole rule sets apply to consumers of those packages, which here are their demos
    {
      files: within('demo/i18n'),
      plugins: { '@astroscope/i18n': i18nPlugin },
      rules: {
        ...rulesOf(astroscope.configs.i18n),
        // the demo's copy explains the demo; it is not ui text to translate
        '@astroscope/i18n/no-raw-strings-in-jsx': 'off',
      },
    },
    {
      files: within('demo/wormhole'),
      plugins: { '@astroscope/wormhole': wormholePlugin },
      rules: rulesOf(astroscope.configs.wormhole),
    },
  ],
});
