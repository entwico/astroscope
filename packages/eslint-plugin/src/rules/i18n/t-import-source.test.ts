import { RuleTester } from 'eslint';
import { tImportSource } from './t-import-source.js';

const tester = new RuleTester();

tester.run('t-import-source', tImportSource, {
  valid: [
    `import { t } from '@astroscope/i18n/translate';`,
    // non-t imports from other sources are fine
    `import { foo } from 'some-other-lib';`,
    `import { translate } from 'other-i18n';`,
  ],
  invalid: [
    {
      code: `import { t } from 'i18next';`,
      errors: [{ messageId: 'wrongSource' }],
    },
    {
      code: `import { t } from './my-translate';`,
      errors: [{ messageId: 'wrongSource' }],
    },
    {
      code: `import { t } from '@astroscope/i18n';`,
      errors: [{ messageId: 'wrongSource' }],
    },
  ],
});
