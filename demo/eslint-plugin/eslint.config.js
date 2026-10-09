import rootConfig from '../../eslint.config.js';

export default [
  // src/examples/ contains intentional-leak fixtures — excluded from default lint
  // run `pnpm lint:demo` to test the rule against them
  { ignores: ['src/examples/**'] },

  ...(await rootConfig),
];
