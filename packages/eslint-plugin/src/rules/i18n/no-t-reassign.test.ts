import { RuleTester } from 'eslint';
import { noTReassign } from './no-t-reassign.js';

const tester = new RuleTester();

tester.run('no-t-reassign', noTReassign, {
  valid: [
    // normal import
    `import { t } from '@astroscope/i18n/translate';`,
    // non-t variable assigned
    `import { t } from '@astroscope/i18n/translate'; const x = y;`,
  ],
  invalid: [
    {
      // aliased import
      code: `import { t as translate } from '@astroscope/i18n/translate';`,
      errors: [{ messageId: 'noAlias' }],
    },
    {
      // reassigned to variable
      code: `import { t } from '@astroscope/i18n/translate'; const translate = t;`,
      errors: [{ messageId: 'noReassign' }],
    },
    {
      // assignment expression
      code: `import { t } from '@astroscope/i18n/translate'; let x; x = t;`,
      errors: [{ messageId: 'noReassign' }],
    },
  ],
});
