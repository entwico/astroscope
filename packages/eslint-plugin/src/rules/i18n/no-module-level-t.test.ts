import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { noModuleLevelT } from './no-module-level-t.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester();

tester.run('no-module-level-t', noModuleLevelT, {
  valid: [
    // inside function
    `function render() { return t('key', 'fallback'); }`,
    // inside arrow function
    `const render = () => t('key', 'fallback');`,
    // inside method
    `const obj = { render() { return t('key', 'fallback'); } };`,
    // inside class method
    `class Foo { render() { return t('key', 'fallback'); } }`,
    // nested functions
    `function outer() { function inner() { return t('key', 'fallback'); } }`,
  ],
  invalid: [
    {
      code: `const title = t('key', 'fallback');`,
      errors: [{ messageId: 'moduleLevelT' }],
    },
    {
      code: `t('key', 'fallback');`,
      errors: [{ messageId: 'moduleLevelT' }],
    },
    {
      code: `console.log(t('key', 'fallback'));`,
      errors: [{ messageId: 'moduleLevelT' }],
    },
  ],
});
