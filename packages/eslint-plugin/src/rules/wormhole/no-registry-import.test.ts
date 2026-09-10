import tsParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { noRegistryImport } from './no-registry-import.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    sourceType: 'module',
  },
});

const filename = 'src/components/Cart.tsx';

tester.run('no-registry-import', noRegistryImport, {
  valid: [
    // the proxy is the client api
    { filename, code: `import { wormholes } from '@astroscope/wormhole';` },
    // types of the registry module are erased
    { filename, code: `import type { Cart } from '../wormholes';` },
    { filename, code: `import { type Cart } from '@/wormholes';` },
    // server code may use the registry
    { filename: 'src/server/render.ts', code: `import { wormholes } from '../wormholes';` },
    // unrelated module with a similar name
    { filename, code: `import { open } from './wormholes-ui';` },
  ],
  invalid: [
    { filename, code: `import { wormholes } from '../wormholes';`, errors: [{ messageId: 'registryImport' }] },
    { filename, code: `import { wormholes } from '@/wormholes';`, errors: [{ messageId: 'registryImport' }] },
    { filename, code: `import { wormholes } from '../wormholes/index.ts';`, errors: [{ messageId: 'registryImport' }] },
    {
      filename: 'src/components/Cart.jsx',
      code: `import { wormholes, type Cart } from 'src/wormholes';`,
      errors: [{ messageId: 'registryImport' }],
    },
  ],
});
