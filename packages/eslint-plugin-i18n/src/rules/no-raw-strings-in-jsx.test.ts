import tsParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { noRawStringsInJsx } from './no-raw-strings-in-jsx.js';

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

const tsTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

tester.run('no-raw-strings-in-jsx', noRawStringsInJsx, {
  valid: [
    // whitespace only
    { code: '<div> </div>;' },
    // expression with t()
    { code: `<div>{t('key', 'fallback')}</div>;` },
    // ignored attributes
    { code: '<div className="container" />;' },
    { code: '<input type="text" />;' },
    { code: '<a href="/path" />;' },
    { code: '<div id="main" />;' },
    // numbers
    { code: '<div>123</div>;' },
    // punctuation only
    { code: '<div>(</div>;' },
    { code: '<div>)</div>;' },
    { code: '<div>,</div>;' },
    { code: '<div>.</div>;' },
    { code: '<div>-</div>;' },
    { code: '<div>/</div>;' },
    { code: '<div>:</div>;' },
    { code: '<div>;</div>;' },
    // punctuation with whitespace
    { code: '<div> ( </div>;' },
    { code: '<div> , </div>;' },
    { code: '<div> — </div>;' },
    // mixed punctuation / symbols
    { code: '<div>/ —</div>;' },
    { code: '<div>&amp;</div>;' },
    // hex colors
    { code: '<meta content="#003366" />;' },
    { code: '<meta content="#fff" />;' },
    // dimensions
    { code: '<link sizes="180x180" />;' },
    // string literals inside function calls in JSX expressions
    { code: `<div>{fn('some string')}</div>;` },
    { code: `<div title={fn('some string')} />;` },
    // string literals in comparisons
    { code: `<div>{value === 'youtube' && <span />}</div>;` },
    // string literals in ternaries inside ignored attributes
    { code: `<img loading={preload ? 'eager' : 'lazy'} />;` },
    { code: `<img fetchPriority={preload ? 'high' : 'low'} />;` },
    // meta tag attributes
    { code: '<meta property="og:type" />;' },
    { code: '<meta property="og:title" />;' },
    { code: '<meta itemprop="image" />;' },
    // svg attributes
    { code: '<path d="M0 0L10 10" />;' },
    { code: '<svg viewBox="0 0 24 24" />;' },
    // *Class / *ClassName / *classNames pattern
    { code: '<div labelClassName="text-sm" />;' },
    { code: '<div pictureClassName="w-full" />;' },
    { code: '<div bodyClass="bg-sv-gradient-hero" />;' },
    { code: '<div wrapperClass="flex p-3" />;' },
    // classNames object prop with string values
    { code: `<Comp classNames={{ root: 'flex p-3', label: 'text-sm' }} />;` },
    // data-* pattern
    { code: '<div data-value="something" />;' },
    // event handlers
    { code: `<button onclick="window.history.back()" />;` },
    { code: `<button onClick="handleClick()" />;` },
    // `in` operator
    { code: `<div>{'href' in obj && <span />}</div>;` },
    // ternary inside ignored attribute
    { code: `<a target={openInNewTab ? '_blank' : undefined} />;` },
  ],
  invalid: [
    {
      code: '<div>Hello World</div>;',
      errors: [{ messageId: 'rawString' }],
    },
    {
      code: '<button>Submit</button>;',
      errors: [{ messageId: 'rawString' }],
    },
    {
      code: '<div title="Welcome" />;',
      errors: [{ messageId: 'rawString' }],
    },
    // string literals in JSX expressions (fallbacks, inline text)
    {
      code: `<div title={value ?? 'Fallback text'} />;`,
      errors: [{ messageId: 'rawString' }],
    },
    {
      code: `<div>{'Hello World'}</div>;`,
      errors: [{ messageId: 'rawString' }],
    },
  ],
});

// typescript-specific tests
tsTester.run('no-raw-strings-in-jsx (ts)', noRawStringsInJsx, {
  valid: [
    // type assertions
    { code: `<Comp filter={{ variants: ['training' as const] }} />;` },
  ],
  invalid: [],
});
