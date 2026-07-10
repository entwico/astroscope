import { RuleTester } from 'eslint';
import { preferXDirectives } from './prefer-x-directives.js';

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

tester.run('prefer-x-directives', preferXDirectives, {
  valid: [
    // already using -x variants
    { code: '<Component client:load-x />;', languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
    { code: '<Component client:visible-x />;', languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
    { code: '<Component client:idle-x />;', languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
    {
      code: '<Component client:media-x="(max-width: 768px)" />;',
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    },
    {
      code: '<Component client:only-x="react" />;',
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    },
    // non-client attributes
    { code: '<Component data:load />;', languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
  ],
  invalid: [
    {
      code: '<Component client:load />;',
      output: '<Component client:load-x />;',
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      errors: [{ messageId: 'preferX' }],
    },
    {
      code: '<Component client:visible />;',
      output: '<Component client:visible-x />;',
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      errors: [{ messageId: 'preferX' }],
    },
    {
      code: '<Component client:idle />;',
      output: '<Component client:idle-x />;',
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      errors: [{ messageId: 'preferX' }],
    },
    {
      code: '<Component client:media="(max-width: 768px)" />;',
      output: '<Component client:media-x="(max-width: 768px)" />;',
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      errors: [{ messageId: 'preferX' }],
    },
    {
      code: '<Component client:only="react" />;',
      output: '<Component client:only-x="react" />;',
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      errors: [{ messageId: 'preferX' }],
    },
  ],
});
