/* eslint-disable unicorn/no-incorrect-template-string-interpolation -- fixture sources contain mf2 placeholders */
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { tValidMessage } from './t-valid-message.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester();

tester.run('t-valid-message', tValidMessage, {
  valid: [
    `t('greeting', 'Hello {$name}', { name });`,
    `t('total', { fallback: 'Total: {$amount :currency currency=EUR}' }, { amount });`,
    `t('when', 'On {$day :date} at {$day :time}', { day });`,
    String.raw`t('results', '.input {$count :number}\n.match $count\none {{{$count} result}}\n* {{{$count} results}}', { count });`,
    `rich('tos', 'Read our {#link}Terms{/link}', { link: (c) => c });`,
    { code: 't(`greeting`, `Hello {$name}`, { name });' },
    // nothing static to read
    `t('greeting');`,
    `t('greeting', fallback);`,
    `t('greeting', { fallback });`,
    // not a translation call
    `format('Hello {$name');`,
  ],
  invalid: [
    {
      // unclosed placeholder
      code: `t('greeting', 'Hello {$name');`,
      errors: [{ messageId: 'invalidMessage' }],
    },
    {
      // a stray closing brace
      code: `t('greeting', { fallback: 'a } b' });`,
      errors: [{ messageId: 'invalidMessage' }],
    },
    {
      code: `rich('greeting', 'Hello {#b}{$name', { b: (c) => c });`,
      errors: [{ messageId: 'invalidMessage' }],
    },
    {
      // a selector needs an annotation and a catch-all variant
      code: String.raw`t('results', '.match $count\none {{one result}}', { count });`,
      errors: [{ messageId: 'invalidMessage' }, { messageId: 'invalidMessage' }],
    },
    {
      code: `t('count', '{$count :nubmer}', { count });`,
      errors: [{ messageId: 'unknownFunction' }],
    },
  ],
});
