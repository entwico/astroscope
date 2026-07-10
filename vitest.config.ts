import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    // astro component tests (`*.astro.test.ts`) need the astro vite plugin — they run from
    // packages/components/vitest.config.ts (its own `pnpm test`), not this node-environment config.
    exclude: [...configDefaults.exclude, 'deprecated/**', '**/*.astro.test.ts'],
  },
});
