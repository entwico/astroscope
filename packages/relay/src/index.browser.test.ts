import { expect, test } from 'vitest';
import relayIntegration from './index.browser.js';

test('the browser entry refuses to act as the integration', () => {
  expect(() => relayIntegration()).toThrow('server-only');
});
