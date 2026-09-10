import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { tRequiresMeta } from './t-requires-meta.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

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
