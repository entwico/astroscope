import { RuleTester } from 'eslint';
import { tStaticMeta } from './t-static-meta.js';

const tester = new RuleTester();

tester.run('t-static-meta', tStaticMeta, {
  valid: [
    // static string shorthand
    `t('cart.total', 'Total');`,
    { code: 't(`cart.total`, `Total`);' },
    // static object form with mf2 variables instead of concatenation
    `t('cart.total', { fallback: 'Total: {amount}', description: 'cart total', variables: { amount: { fallback: '$0', description: 'the amount' } } });`,
    // no meta — handled by other rules
    `t('cart.total');`,
  ],
  invalid: [
    {
      // concatenated shorthand fallback
      code: `t('greeting', 'Hello ' + name);`,
      errors: [{ messageId: 'dynamicMeta' }],
    },
    {
      // interpolated template shorthand fallback
      code: 't(`greeting`, `Hello ${name}`);',
      errors: [{ messageId: 'dynamicMeta' }],
    },
    {
      // concatenated fallback in object form
      code: `t('greeting', { fallback: 'Hello ' + name });`,
      errors: [{ messageId: 'dynamicMeta' }],
    },
    {
      // concatenated description in object form
      code: `t('greeting', { fallback: 'Hi', description: 'used on ' + page });`,
      errors: [{ messageId: 'dynamicMeta' }],
    },
    {
      // concatenated per-variable fallback
      code: `t('greeting', { fallback: '{name}', variables: { name: { fallback: 'Mr ' + last } } });`,
      errors: [{ messageId: 'dynamicMeta' }],
    },
    {
      // interpolated per-variable description
      code: 't(`greeting`, { variables: { name: { description: `from ${src}` } } });',
      errors: [{ messageId: 'dynamicMeta' }],
    },
  ],
});
