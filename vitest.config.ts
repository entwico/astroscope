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
    // the react render bench imports upstream's server entry, whose
    // `astro:react:opts` import must go through vite so vi.mock can serve it
    server: { deps: { inline: ['@astrojs/react'] } },
    // astro component tests (`*.astro.test.ts`) need the astro vite plugin — they run from
    // packages/components/vitest.config.ts (its own `pnpm test`), not this node-environment config.
    exclude: [...configDefaults.exclude, 'deprecated/**', '**/*.astro.test.ts'],
    benchmark: {
      // the benches run package source through vite's module runner, where every
      // cross-module binding is an export getter; the code under test (not the
      // bench files) hits them per call, so the overhead is a constant the
      // before/after comparison cancels out — absolute numbers carry it
      suppressExportGetterWarnings: true,
    },
  },
});
