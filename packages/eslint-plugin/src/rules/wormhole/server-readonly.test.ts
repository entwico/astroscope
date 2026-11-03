/* eslint-disable unicorn/no-incorrect-template-string-interpolation -- fixture sources contain template syntax */
import tsParser from '@typescript-eslint/parser';
import * as astroEslintParser from 'astro-eslint-parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { serverReadonly } from './server-readonly.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: astroEslintParser,
    sourceType: 'module',
    parserOptions: { parser: tsParser },
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
    // the other exports of a namespace import are not the registry
    {
      filename,
      code: `---
import * as W from '@astroscope/wormhole';

const cart = W.wormholes.cart.get();
W.openWormholes.set?.({});
---
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
    // computed method, typescript wrappers, namespace import
    {
      filename,
      code: `---
import { wormholes } from '@astroscope/wormhole';

wormholes.counter['set']({ count: 1 });
---
`,
      errors: [{ messageId: 'serverSet' }],
    },
    {
      filename,
      code: `---
import { wormholes } from '@astroscope/wormhole';

wormholes.cart.set!({ items: [] });
(wormholes.cart as any).subscribe(() => {});
---
`,
      errors: [{ messageId: 'serverSet' }, { messageId: 'serverSubscribe' }],
    },
    {
      filename,
      code: `---
import * as W from '@astroscope/wormhole';

W.wormholes.cart.set({ items: [] });
---
`,
      errors: [{ messageId: 'serverSet' }],
    },
  ],
});
