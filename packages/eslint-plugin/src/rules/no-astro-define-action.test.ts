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
    // a type cannot define an action
    `import type { defineAction } from 'astro:actions';`,
    `import { type defineAction, ActionError } from 'astro:actions';`,
    `export type { defineAction } from 'astro:actions';`,
    `export { type defineAction, ActionError } from 'astro:actions';`,
    // the other exports stay legal through every import form
    `import * as astroActions from 'astro:actions';\nexport const { ActionError } = astroActions;\nconst ctx = astroActions.getActionContext(c);`,
    `export { actions, ActionError } from 'astro:actions';`,
    `const { actions } = await import('astro:actions');`,
    `const m = await import('astro:actions');\nm.actions.like();`,
    `const m = await import(name);\nm.defineAction({});`,
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
    {
      code: `import { defineAction } from 'astro:actions' with { type: 'module' };`,
      output: `import { defineAction } from '@astroscope/node/guards' with { type: 'module' };`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    // namespace import
    {
      code: `import * as astroActions from 'astro:actions';\nexport const like = astroActions.defineAction({ handler: () => null });`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    {
      code: `import * as astroActions from 'astro:actions';\nexport const like = astroActions['defineAction']({ handler: () => null });`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    // re-exports hand the unguarded defineAction to every importer
    {
      code: `export { defineAction } from 'astro:actions';`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    {
      code: `export { defineAction as define, ActionError } from 'astro:actions';`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    {
      code: `export * from 'astro:actions';`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    // dynamic import
    {
      code: `const { defineAction } = await import('astro:actions');`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    {
      code: `const { defineAction: define } = await import('astro:actions');`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    {
      code: `const m = await import('astro:actions');\nexport const like = m.defineAction({});`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
    {
      code: `export const like = (await import('astro:actions')).defineAction({});`,
      errors: [{ messageId: 'astroDefineAction' }],
    },
  ],
});
