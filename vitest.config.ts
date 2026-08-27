import { configDefaults, defineConfig } from 'vitest/config';

// resolves /_i18n/ urls to modules that record their own evaluation, so the
// gate runtime's unit tests can observe its eager imports
const i18nImportRecorder = {
  name: 'test:i18n-import-recorder',
  resolveId(id: string) {
    if (id.startsWith('/_i18n/')) {
      return `\0recorded:${id}`;
    }
  },
  load(id: string) {
    if (id.startsWith('\0recorded:')) {
      const url = id.slice('\0recorded:'.length);

      return `(globalThis.__importedI18nUrls__ ??= []).push(${JSON.stringify(url)});`;
    }
  },
};

export default defineConfig({
  plugins: [i18nImportRecorder],
  test: {
    passWithNoTests: true,
    // astro component tests (`*.astro.test.ts`) need the astro vite plugin — they run from
    // packages/components/vitest.config.ts (its own `pnpm test`), not this node-environment config.
    exclude: [...configDefaults.exclude, 'deprecated/**', '**/*.astro.test.ts'],
  },
});
