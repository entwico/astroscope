import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

import { noClientDirectiveOnAstroComponent } from './no-client-directive-on-astro-component.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

const filename = 'test.tsx';

tester.run('no-client-directive-on-astro-component', noClientDirectiveOnAstroComponent, {
  valid: [
    // framework component (non-.astro import) may hydrate
    {
      filename,
      code: `
        import Widget from './Widget.tsx';
        export const v = <Widget client:load />;
      `,
    },
    // astro component without a client directive
    {
      filename,
      code: `
        import Card from './Card.astro';
        export const v = <Card title="x" />;
      `,
    },
  ],
  invalid: [
    {
      filename,
      code: `
        import Card from './Card.astro';
        export const v = <Card client:visible />;
      `,
      errors: [{ messageId: 'astroIsland', data: { directive: 'client:visible', comp: 'Card' } }],
    },
    {
      filename,
      code: `
        import { Inner } from './widgets.astro';
        export const v = <Inner client:load />;
      `,
      errors: [{ messageId: 'astroIsland', data: { directive: 'client:load', comp: 'Inner' } }],
    },
  ],
});
