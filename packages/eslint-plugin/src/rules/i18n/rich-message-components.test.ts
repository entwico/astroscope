/* eslint-disable unicorn/no-incorrect-template-string-interpolation -- fixture sources contain mf2 placeholders */
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { richMessageComponents } from './rich-message-components.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester();

tester.run('rich-message-components', richMessageComponents, {
  valid: [
    `rich('tos', 'Read our {#link}Terms{/link}', { link: (c) => c });`,
    `rich('legal', { fallback: '{#bold}very {#em}important{/em}{/bold} {#icon/}' }, { bold, em, icon });`,
    `rich('plain', 'No markup');`,
    `rich('plain', 'Hello {$name}', undefined, { name });`,
    // components the rule cannot see into
    `rich('tos', 'Read our {#link}Terms{/link}', components);`,
    `rich('tos', 'Read our {#link}Terms{/link}', { ...components });`,
    // t() ignores markup
    `t('tos', 'Read our {#link}Terms{/link}');`,
    // invalid (reported by t-valid-message)
    `rich('tos', 'Read our {#link}Terms{/link', {});`,
  ],
  invalid: [
    {
      code: `rich('tos', 'Read our {#link}Terms{/link}');`,
      errors: [{ messageId: 'missingComponent', data: { name: 'link' } }],
    },
    {
      code: `rich('tos', 'Read our {#link}Terms{/link}', { a: (c) => c });`,
      errors: [
        { messageId: 'missingComponent', data: { name: 'link' } },
        { messageId: 'unusedComponent', data: { name: 'a' } },
      ],
    },
    {
      code: `rich('install', 'Click {#icon/} to install', {}, {});`,
      errors: [{ messageId: 'missingComponent', data: { name: 'icon' } }],
    },
    {
      // a tag of one variant only still needs its component
      code: String.raw`rich('results', '.input {$count :number}\n.match $count\none {{{#b}one{/b} result}}\n* {{{$count} results}}', {}, { count });`,
      errors: [{ messageId: 'missingComponent', data: { name: 'b' } }],
    },
    {
      code: `rich('plain', 'No markup', { link: (c) => c });`,
      errors: [{ messageId: 'unusedComponent', data: { name: 'link' } }],
    },
    {
      code: `rich('tos', 'Read our {#link}Terms', { link: (c) => c });`,
      errors: [{ messageId: 'unbalancedTag', data: { name: 'link' } }],
    },
    {
      code: `rich('tos', 'Read our {#a}Terms{/b}', { a, b });`,
      errors: [{ messageId: 'unbalancedTag', data: { name: 'b' } }],
    },
  ],
});
