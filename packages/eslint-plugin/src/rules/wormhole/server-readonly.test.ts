import tsParser from '@typescript-eslint/parser';
import * as astroEslintParser from 'astro-eslint-parser';
import { RuleTester } from 'eslint';
import { serverReadonly } from './server-readonly.js';

const tester = new RuleTester({
  languageOptions: {
    parser: astroEslintParser,
    sourceType: 'module',
  },
});

const filename = 'src/pages/index.astro';

tester.run('server-readonly', serverReadonly, {
  valid: [
    // reading is fine in frontmatter
    {
      filename,
      code: `---
import { wormholes } from '@astroscope/wormhole';

const cart = wormholes.cart.get();
---

<p>{cart.count}</p>
`,
    },
    // client <script> blocks are not part of the linted server program
    {
      filename,
      code: `---
---

<script>
  import { wormholes } from '@astroscope/wormhole';

  wormholes.counter.set({ count: 1 });
  wormholes.counter.subscribe(() => {});
</script>
`,
    },
    // .ts files are out of scope — set() there may be legit client code
    {
      filename: 'src/components/Counter.tsx',
      code: `import { wormholes } from '@astroscope/wormhole'; wormholes.counter.set({ count: 1 });`,
      languageOptions: { parser: tsParser },
    },
  ],
  invalid: [
    {
      filename,
      code: `---
import { wormholes } from '@astroscope/wormhole';

wormholes.counter.set({ count: 1 });
---
`,
      errors: [{ messageId: 'serverSet' }],
    },
    {
      filename,
      code: `---
import { wormholes } from '../wormholes';

wormholes.counter.subscribe(() => {});
---
`,
      errors: [{ messageId: 'serverSubscribe' }],
    },
    {
      filename,
      code: `---
import { wormholes } from '@astroscope/wormhole';

wormholes['counter'].set({ count: 1 });
---
`,
      errors: [{ messageId: 'serverSet' }],
    },
  ],
});
