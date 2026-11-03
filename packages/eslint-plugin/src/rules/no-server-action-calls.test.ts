/* eslint-disable unicorn/no-incorrect-template-string-interpolation -- fixture sources contain template syntax */
import tsParser from '@typescript-eslint/parser';
import * as astroEslintParser from 'astro-eslint-parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { noServerActionCalls } from './no-server-action-calls.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: astroEslintParser,
    sourceType: 'module',
    parserOptions: { parser: tsParser },
  },
});

const filename = 'src/pages/index.astro';

tester.run('no-server-action-calls', noServerActionCalls, {
  valid: [
    // action reference as form target — the intended server-side usage
    {
      filename,
      code: `---
import { actions } from 'astro:actions';
---
<form method="POST" action={actions.like}></form>
`,
    },
    // reading the submitted result
    {
      filename,
      code: `---
import { actions } from 'astro:actions';

const result = Astro.getActionResult(actions.like);
---
`,
    },
    // nested action reference, still not a call
    {
      filename,
      code: `---
import { actions } from 'astro:actions';
---
<form method="POST" action={actions.blog.comment.like}></form>
`,
    },
    // client files are out of scope
    {
      filename: 'src/components/Like.tsx',
      code: `import { actions } from 'astro:actions'; await actions.like({ id: 1 });`,
      languageOptions: { parser: tsParser },
    },
    // `actions` from another module is not the astro registry
    {
      filename,
      code: `---
import { actions } from './store';

actions.like({ id: 1 });
---
`,
    },
    // the other exports of a namespace import are not the registry
    {
      filename,
      code: `---
import * as astroActions from 'astro:actions';

const ctx = astroActions.getActionContext(Astro);
const result = Astro.getActionResult(astroActions.actions.like);
---
<form method="POST" action={astroActions.actions.like}></form>
`,
    },
    // other reads off Astro
    {
      filename,
      code: `---
const { getActionResult } = Astro;
const result = Astro['getActionResult'](actions.like);
---
`,
    },
  ],
  invalid: [
    // direct call in frontmatter
    {
      filename,
      code: `---
import { actions } from 'astro:actions';

const result = await actions.like({ id: 1 });
---
`,
      errors: [{ messageId: 'directCall' }],
    },
    // orThrow variant
    {
      filename,
      code: `---
import { actions } from 'astro:actions';

const result = await actions.like.orThrow({ id: 1 });
---
`,
      errors: [{ messageId: 'directCall' }],
    },
    // nested registry path
    {
      filename,
      code: `---
import { actions } from 'astro:actions';

await actions.blog.comment.like({ id: 1 });
---
`,
      errors: [{ messageId: 'directCall' }],
    },
    // call in a template expression renders server-side too
    {
      filename,
      code: `---
import { actions } from 'astro:actions';
---
<div>{actions.like({ id: 1 })}</div>
`,
      errors: [{ messageId: 'directCall' }],
    },
    // callAction is forbidden by default
    {
      filename,
      code: `---
import { actions } from 'astro:actions';

const result = await Astro.callAction(actions.like, { id: 1 });
---
`,
      errors: [{ messageId: 'callAction' }],
    },
    // callAction through a computed member, a destructuring and an alias
    {
      filename,
      code: `---
import { actions } from 'astro:actions';

const result = await Astro['callAction'](actions.like, { id: 1 });
---
`,
      errors: [{ messageId: 'callAction' }],
    },
    {
      filename,
      code: `---
const { callAction } = Astro;
---
`,
      errors: [{ messageId: 'callAction' }],
    },
    {
      filename,
      code: `---
const call = Astro.callAction;
---
`,
      errors: [{ messageId: 'callAction' }],
    },
    // namespace import of the registry
    {
      filename,
      code: `---
import * as astroActions from 'astro:actions';

const result = await astroActions.actions.like({ id: 1 });
---
`,
      errors: [{ messageId: 'directCall' }],
    },
    {
      filename,
      code: `---
import * as astroActions from 'astro:actions';

const result = await astroActions['actions'].blog.like.orThrow({ id: 1 });
---
`,
      errors: [{ messageId: 'directCall' }],
    },
    // typescript wrappers and computed keys read like the plain form
    {
      filename,
      code: `---
import { actions } from 'astro:actions';

const result = await actions.like!({ id: 1 });
---
`,
      errors: [{ messageId: 'directCall' }],
    },
    {
      filename,
      code: `---
import { actions } from 'astro:actions';

const result = await (actions.like as any)({ id: 1 });
---
`,
      errors: [{ messageId: 'directCall' }],
    },
    {
      filename,
      code: `---
import { actions } from 'astro:actions';

const result = await actions['like']({ id: 1 });
---
`,
      errors: [{ messageId: 'directCall' }],
    },
  ],
});
