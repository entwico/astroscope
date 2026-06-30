import { RuleTester } from '@typescript-eslint/rule-tester';
import * as astroParser from 'astro-eslint-parser';
import { afterAll, describe, it } from 'vitest';

import { noHtmlComments } from './no-html-comments.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    // no-html-comments is AST-only (no type info needed), so we can skip
    // project config entirely and keep tests fast.
    parser: astroParser,
    parserOptions: {
      extraFileExtensions: ['.astro'],
    },
  },
});

const filename = 'test.astro';

tester.run('no-html-comments', noHtmlComments, {
  valid: [
    // jsx-style comment — the correct form
    {
      filename,
      code: `---\n---\n\n<div>{/* hidden at build time */}</div>`,
    },
    // plain text, no comments
    {
      filename,
      code: `---\n---\n\n<div>hello</div>`,
    },
    // frontmatter line comment — that's JS, not HTML
    {
      filename,
      code: `---\n// ok\n---\n\n<div>hi</div>`,
    },
    // frontmatter block comment — also JS
    {
      filename,
      code: `---\n/* ok */\n---\n\n<div>hi</div>`,
    },
  ],

  invalid: [
    // basic HTML comment → fix to jsx block comment
    {
      filename,
      code: `---\n---\n\n<div><!-- secret --></div>`,
      errors: [{ messageId: 'htmlComment' }],
      output: `---\n---\n\n<div>{/* secret */}</div>`,
    },
    // HTML comment at top level of template
    {
      filename,
      code: `---\n---\n\n<!-- TODO -->\n<div>hi</div>`,
      errors: [{ messageId: 'htmlComment' }],
      output: `---\n---\n\n{/* TODO */}\n<div>hi</div>`,
    },
    // multi-line HTML comment → fix preserves content including newlines
    {
      filename,
      code: `---\n---\n\n<div>\n  <!--\n    block comment\n  -->\n</div>`,
      errors: [{ messageId: 'htmlComment' }],
      output: `---\n---\n\n<div>\n  {/*\n    block comment\n  */}\n</div>`,
    },
    // multiple HTML comments → each reported, each fixed
    {
      filename,
      code: `---\n---\n\n<!-- a --><div><!-- b --></div>`,
      errors: [{ messageId: 'htmlComment' }, { messageId: 'htmlComment' }],
      output: `---\n---\n\n{/* a */}<div>{/* b */}</div>`,
    },
    // HTML comment whose body contains `*/` is reported but NOT autofixed
    // (can't safely rewrite into a JSX block comment that would terminate early).
    {
      filename,
      code: `---\n---\n\n<!-- has */ inside --><div />`,
      errors: [{ messageId: 'htmlComment' }],
      output: null,
    },
  ],
});
