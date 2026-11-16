/* eslint-disable unicorn/no-incorrect-template-string-interpolation -- fixture sources contain mf2 placeholders */
import tsParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { tMessageValues } from './t-message-values.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester();

tester.run('t-message-values', tMessageValues, {
  valid: [
    `t('title', 'Welcome');`,
    `t('greeting', 'Hello {$name}', { name });`,
    `t('greeting', { fallback: 'Hello {$name}' }, { 'name': user.name });`,
    `t('greeting', { fallback: 'Hello {$name}', variables: { name: { description: 'the user' } } }, { name });`,
    `rich('greeting', 'Hello {$name}, see {#link}this{/link}', { link: (c) => c }, { name });`,
    `rich('greeting', 'Hello {$name}', undefined, { name });`,
    // a variable used in one variant only, in an option, and a local one
    String.raw`t('results', '.input {$count :number}\n.match $count\none {{one result for {$query}}}\n* {{{$count} results}}', { count, query });`,
    `t('price', '{$amount :number minimumFractionDigits=$digits}', { amount, digits });`,
    String.raw`t('price', '.local $shown = {$amount :number}\n{{{$shown}}}', { amount });`,
    // values the rule cannot see into
    `t('greeting', 'Hello {$name}', values);`,
    `t('greeting', 'Hello {$name}', getValues());`,
    `t('greeting', 'Hello {$name}', { ...values });`,
    `t('greeting', 'Hello {$name}', { [key]: value });`,
    // nothing static to read, or invalid (reported by t-valid-message)
    `t('greeting', fallback, { name });`,
    `t('greeting', 'Hello {$name', {});`,
    {
      code: `t('greeting', 'Hello {$name}', { name } as const);`,
      languageOptions: { parser: tsParser },
    },
  ],
  invalid: [
    {
      code: `t('greeting', 'Hello {$name}');`,
      errors: [{ messageId: 'missingValue', data: { name: 'name' } }],
    },
    {
      code: `t('greeting', { fallback: 'Hello {$first} {$last}' }, { first });`,
      errors: [{ messageId: 'missingValue', data: { name: 'last' } }],
    },
    {
      // the values of rich() are its fourth argument
      code: `rich('greeting', 'Hello {$name}, see {#link}this{/link}', { link: (c) => c });`,
      errors: [{ messageId: 'missingValue', data: { name: 'name' } }],
    },
    {
      code: `rich('greeting', 'Hello {#b}you{/b}', { b: (c) => c }, { name });`,
      errors: [{ messageId: 'unusedValue', data: { name: 'name' } }],
    },
    {
      code: `t('title', 'Welcome', { name });`,
      errors: [{ messageId: 'unusedValue', data: { name: 'name' } }],
    },
    {
      // a variable of one variant only still needs its value
      code: String.raw`t('results', '.input {$count :number}\n.match $count\none {{one result for {$query}}}\n* {{{$count} results}}', { count });`,
      errors: [{ messageId: 'missingValue', data: { name: 'query' } }],
    },
    {
      // `{name}` is the text "name"
      code: `t('greeting', 'Hello {name}', { name });`,
      errors: [{ messageId: 'literalPlaceholder', data: { name: 'name' } }],
    },
    {
      // a spread can supply the missing value, but a named one is still unused
      code: `t('greeting', 'Hello {$name}', { ...rest, age });`,
      errors: [{ messageId: 'unusedValue', data: { name: 'age' } }],
    },
    {
      code: `t('greeting', { fallback: 'Hello {$name}', variables: { user: { description: 'the user' } } }, { name });`,
      errors: [{ messageId: 'unknownMetaVariable', data: { name: 'user' } }],
    },
  ],
});
