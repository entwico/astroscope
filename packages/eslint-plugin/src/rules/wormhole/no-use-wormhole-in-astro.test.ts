import tsParser from '@typescript-eslint/parser';
import * as astroEslintParser from 'astro-eslint-parser';
import { RuleTester } from 'eslint';
import { noUseWormholeInAstro } from './no-use-wormhole-in-astro.js';

const tester = new RuleTester({
  languageOptions: {
    parser: astroEslintParser,
    sourceType: 'module',
  },
});

const filename = 'src/pages/index.astro';

tester.run('no-use-wormhole-in-astro', noUseWormholeInAstro, {
  valid: [
    // server read in frontmatter
    {
      filename,
      code: `---
import { wormholes } from '@astroscope/wormhole';

const cart = wormholes.cart.get();
---
`,
    },
    // react files are out of scope
    {
      filename: 'src/components/Cart.tsx',
      code: `import { useWormhole } from '@astroscope/wormhole/react'; useWormhole(w);`,
      languageOptions: { parser: tsParser },
    },
  ],
  invalid: [
    {
      filename,
      code: `---
import { useWormhole } from '@astroscope/wormhole/react';
---
`,
      errors: [{ messageId: 'useWormholeInAstro' }],
    },
  ],
});
