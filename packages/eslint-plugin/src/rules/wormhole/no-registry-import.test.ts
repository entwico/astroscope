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
    { filename, code: `const ui = await import('./wormholes-ui');` },
    // type-only re-exports are erased
    { filename, code: `export type { Cart } from '../wormholes';` },
    { filename, code: `export { type Cart } from '../wormholes';` },
    { filename, code: `export type * from '../wormholes';` },
    // a dynamic specifier is not the registry as far as the rule can tell
    { filename, code: `const m = await import(registryPath);` },
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
    { filename, code: `import { wormholes } from '../wormholes.tsx';`, errors: [{ messageId: 'registryImport' }] },
    { filename, code: `import { wormholes } from '../wormholes.mjs';`, errors: [{ messageId: 'registryImport' }] },
    // a side-effect import loads the registry all the same
    { filename, code: `import '../wormholes';`, errors: [{ messageId: 'registryImport' }] },
    // re-exports
    { filename, code: `export { wormholes } from '../wormholes';`, errors: [{ messageId: 'registryImport' }] },
    { filename, code: `export { wormholes, type Cart } from '@/wormholes';`, errors: [{ messageId: 'registryImport' }] },
    { filename, code: `export * from '../wormholes';`, errors: [{ messageId: 'registryImport' }] },
    { filename, code: `export * as registry from '../wormholes/index.ts';`, errors: [{ messageId: 'registryImport' }] },
    // dynamic import
    { filename, code: `const m = await import('../wormholes');`, errors: [{ messageId: 'registryImport' }] },
    { filename, code: `const m = await import(\`@/wormholes\`);`, errors: [{ messageId: 'registryImport' }] },
  ],
});
