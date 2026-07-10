import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tsParser from '@typescript-eslint/parser';
import * as astroEslintParser from 'astro-eslint-parser';
import type { ESLint, Linter, Rule } from 'eslint';

import { i18nConfigs } from './i18n.js';
import { islandNotSerializable } from './rules/island-not-serializable.js';
import { islandReadonly } from './rules/island-readonly.js';
import { noClientDirectiveOnAstroComponent } from './rules/no-client-directive-on-astro-component.js';
import { noExcessJsxProps } from './rules/no-excess-jsx-props.js';
import { noHtmlComments } from './rules/no-html-comments.js';
import { preferSsrGuard } from './rules/prefer-ssr-guard.js';

const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
) as { version: string };

const plugin: ESLint.Plugin & { configs: Record<string, Linter.Config | Linter.Config[]> } = {
  meta: {
    name: '@astroscope/eslint-plugin',
    version: pkg.version,
  },
  rules: {
    'no-excess-jsx-props': noExcessJsxProps as unknown as Rule.RuleModule,
    'no-html-comments': noHtmlComments as unknown as Rule.RuleModule,
    'prefer-ssr-guard': preferSsrGuard as unknown as Rule.RuleModule,
    'island-readonly': islandReadonly as unknown as Rule.RuleModule,
    'island-not-serializable': islandNotSerializable as unknown as Rule.RuleModule,
    'no-client-directive-on-astro-component': noClientDirectiveOnAstroComponent as unknown as Rule.RuleModule,
  },
  configs: {},
};

plugin.configs.recommended = [
  {
    name: '@astroscope/recommended',
    files: ['**/*.astro'],
    languageOptions: {
      parser: astroEslintParser,
      sourceType: 'module',
      parserOptions: {
        parser: tsParser,
        // projectService is not supported by astro-eslint-parser yet
        // that is why performance is not that good since it creates a parallel program
        project: true,
        extraFileExtensions: ['.astro'],
      },
    },
    plugins: {
      '@astroscope': plugin,
    },
    rules: {
      '@astroscope/no-excess-jsx-props': 'error',
      '@astroscope/no-html-comments': 'error',
      '@astroscope/island-readonly': 'error',
      '@astroscope/island-not-serializable': 'error',
      '@astroscope/no-client-directive-on-astro-component': 'error',
    },
  },
  {
    name: '@astroscope/recommended-scripts',
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    plugins: {
      '@astroscope': plugin,
    },
    rules: {
      '@astroscope/prefer-ssr-guard': 'error',
    },
  },
] satisfies Linter.Config[];

// i18n rules for @astroscope/i18n projects, opt-in alongside `recommended`
plugin.configs.i18n = i18nConfigs;

export { i18nPlugin } from './i18n.js';
export { DEFAULT_IGNORE_ATTRIBUTES } from './rules/i18n/no-raw-strings-in-jsx.js';

export default plugin;
