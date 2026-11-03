import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { tStaticKey } from './t-static-key.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester();

tester.run('t-static-key', tStaticKey, {
  valid: [
    // string literal
    `t('checkout.title', 'Checkout');`,
    // template literal with no expressions
    { code: 't(`checkout.title`, `Checkout`);' },
    `rich('tos', 'Read our {#link}Terms{/link}', { link: (c) => c });`,
  ],
  invalid: [
    {
      // variable
      code: `t(key, 'fallback');`,
      errors: [{ messageId: 'dynamicKey' }],
    },
    {
      // template literal with expression
      code: 't(`prefix.${suffix}`, `fallback`);',
      errors: [{ messageId: 'dynamicKey' }],
    },
    {
      // string concatenation
      code: `t('prefix.' + suffix, 'fallback');`,
      errors: [{ messageId: 'dynamicKey' }],
    },
    {
      // rich() is extracted like t()
      code: `rich(key, 'fallback', { link: (c) => c });`,
      errors: [{ messageId: 'dynamicKey' }],
    },
  ],
});
