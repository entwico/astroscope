import { RuleTester } from 'eslint';
import { wormholesStaticAccess } from './wormholes-static-access.js';

const tester = new RuleTester({ languageOptions: { sourceType: 'module' } });

const filename = 'src/components/Cart.jsx';

tester.run('wormholes-static-access', wormholesStaticAccess, {
  valid: [
    {
      filename,
      code: `
        import { wormholes } from '@astroscope/wormhole';
        wormholes.cart.get();
        wormholes['session'].subscribe(() => {});
      `,
    },
    // other imports from the package are not the proxy
    {
      filename,
      code: `import { defineWormhole } from '@astroscope/wormhole'; defineWormhole();`,
    },
    // a local variable of the same name is unrelated
    {
      filename,
      code: `const wormholes = { cart: 1 }; const w = wormholes; wormholes[key];`,
    },
    // astro files are server-rendered, slicing does not apply
    {
      filename: 'src/pages/index.astro',
      code: `import { wormholes } from '@astroscope/wormhole'; const w = wormholes;`,
    },
  ],
  invalid: [
    {
      filename,
      code: `import { wormholes } from '@astroscope/wormhole'; wormholes[name].get();`,
      errors: [{ messageId: 'dynamicAccess' }],
    },
    {
      filename,
      code: "import { wormholes } from '@astroscope/wormhole'; wormholes[`cart.${x}`].get();",
      errors: [{ messageId: 'dynamicAccess' }],
    },
    {
      filename,
      code: `import { wormholes } from '@astroscope/wormhole'; const w = wormholes;`,
      errors: [{ messageId: 'aliasedProxy' }],
    },
    {
      filename,
      code: `import { wormholes } from '@astroscope/wormhole'; const { cart } = wormholes;`,
      errors: [{ messageId: 'aliasedProxy' }],
    },
    {
      filename,
      code: `import { wormholes as w } from '@astroscope/wormhole'; use(w);`,
      errors: [{ messageId: 'aliasedProxy' }],
    },
  ],
});
