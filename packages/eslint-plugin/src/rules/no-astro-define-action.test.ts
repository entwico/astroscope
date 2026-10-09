import tsParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { noAstroDefineAction } from './no-astro-define-action.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    sourceType: 'module',
  },
});

tester.run('no-astro-define-action', noAstroDefineAction, {
  valid: [
    `import { defineAction } from '@astroscope/node/guards';`,
    `import { ActionError, getActionContext } from 'astro:actions';`,
    `import { actions } from 'astro:actions';`,
    `import { defineAction } from './own-actions';`,
  ],
  invalid: [
    {
      code: `import { defineAction } from 'astro:actions';`,
      output: `import { defineAction } from '@astroscope/node/guards';`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    {
      code: `import { defineAction } from "astro:actions";`,
      output: `import { defineAction } from "@astroscope/node/guards";`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    {
      code: `import { ActionError, defineAction, type ActionAPIContext } from 'astro:actions';`,
      output: `import { defineAction } from '@astroscope/node/guards';\nimport { ActionError, type ActionAPIContext } from 'astro:actions';`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    {
      code: `import { defineAction as define } from 'astro:actions';`,
      output: `import { defineAction as define } from '@astroscope/node/guards';`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    {
      code: `import { defineAction } from 'astro:actions';`,
      options: [{ source: '@/server/actions' }],
      output: `import { defineAction } from '@/server/actions';`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
  ],
});
