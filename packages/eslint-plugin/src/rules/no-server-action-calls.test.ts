import tsParser from '@typescript-eslint/parser';
import * as astroEslintParser from 'astro-eslint-parser';
import { RuleTester } from 'eslint';
import { noServerActionCalls } from './no-server-action-calls.js';

const tester = new RuleTester({
  languageOptions: {
    parser: astroEslintParser,
    sourceType: 'module',
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
  ],
});
