/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// astro component tests use the Container API, which needs astro's vite plugin to compile `.astro`.
// run via this package's `pnpm test`; the pure-logic `*.test.ts` run under the root vitest config.
export default getViteConfig({
  test: {
    include: ['src/**/*.astro.test.ts'],
  },
});
