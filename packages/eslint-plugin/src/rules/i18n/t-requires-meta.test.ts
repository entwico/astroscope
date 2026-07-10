import { RuleTester } from 'eslint';
import { tRequiresMeta } from './t-requires-meta.js';

const tester = new RuleTester();

tester.run('t-requires-meta', tRequiresMeta, {
  valid: [
    // string fallback
    `t('key', 'fallback');`,
    // object meta
    `t('key', { fallback: 'Hello' });`,
    // with values
    `t('key', 'fallback', { count: 5 });`,
  ],
  invalid: [
    {
      code: `t('key');`,
      errors: [{ messageId: 'missingMeta' }],
    },
  ],
});
