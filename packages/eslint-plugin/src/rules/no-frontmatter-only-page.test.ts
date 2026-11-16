/* eslint-disable unicorn/no-incorrect-template-string-interpolation -- fixture sources contain astro expressions */
import tsParser from '@typescript-eslint/parser';
import * as astroParser from 'astro-eslint-parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { noFrontmatterOnlyPage } from './no-frontmatter-only-page.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: astroParser,
    parserOptions: { parser: tsParser, extraFileExtensions: ['.astro'] },
  },
});

const page = '/site/src/pages/onboarding/index.astro';
const redirect = `---\nconst target = await getRoute();\n\nreturn Astro.redirect(target, 302);\n---\n`;

tester.run('no-frontmatter-only-page', noFrontmatterOnlyPage, {
  valid: [
    { filename: page, code: `---\nconst title = 'Hi';\n---\n\n<h1>{title}</h1>` },
    { filename: page, code: `---\nconst html = await render();\n---\n{html}` },
    { filename: page, code: `---\nconst title = 'Hi';\n---\nplain text` },
    // no frontmatter at all
    { filename: page, code: `<h1>Hi</h1>` },
    { filename: page, code: `` },
    // a redirect page with a visible fallback
    { filename: page, code: `---\nif (!user) return Astro.redirect('/login');\n---\n<Dashboard />` },
    // not a page
    { filename: '/site/src/components/Redirect.astro', code: redirect },
    { filename: '/site/src/pages/api/redirect.ts', code: `export const GET = () => new Response(null);`, languageOptions: { parser: tsParser } },
  ],
  invalid: [
    { filename: page, code: redirect, errors: [{ messageId: 'frontmatterOnly', line: 1 }] },
    { filename: String.raw`C:\site\src\pages\index.astro`, code: redirect, errors: [{ messageId: 'frontmatterOnly' }] },
    // whitespace and comments render nothing
    { filename: page, code: `${redirect}\n   \n`, errors: [{ messageId: 'frontmatterOnly' }] },
    { filename: page, code: `${redirect}{/* nothing here */}\n`, errors: [{ messageId: 'frontmatterOnly' }] },
    { filename: page, code: `${redirect}<!-- nothing here -->\n`, errors: [{ messageId: 'frontmatterOnly' }] },
  ],
});
