import type { ESLint, Linter } from 'eslint';
import { noModuleLevelT } from './rules/i18n/no-module-level-t.js';
import { noRawStringsInJsx } from './rules/i18n/no-raw-strings-in-jsx.js';
import { noTReassign } from './rules/i18n/no-t-reassign.js';
import { preferXDirectives } from './rules/i18n/prefer-x-directives.js';
import { tImportSource } from './rules/i18n/t-import-source.js';
import { tRequiresMeta } from './rules/i18n/t-requires-meta.js';
import { tStaticKey } from './rules/i18n/t-static-key.js';
import { tStaticMeta } from './rules/i18n/t-static-meta.js';

/**
 * The i18n rules keep their own plugin namespace (`@astroscope/i18n`) so rule
 * ids — and inline eslint-disable comments referencing them — stay identical
 * to the former `@astroscope/eslint-plugin-i18n` package.
 */
export const i18nPlugin: ESLint.Plugin = {
  meta: {
    name: '@astroscope/eslint-plugin/i18n',
  },
  rules: {
    't-import-source': tImportSource,
    'no-module-level-t': noModuleLevelT,
    't-static-key': tStaticKey,
    't-static-meta': tStaticMeta,
    't-requires-meta': tRequiresMeta,
    'prefer-x-directives': preferXDirectives,
    'no-raw-strings-in-jsx': noRawStringsInJsx,
    'no-t-reassign': noTReassign,
  },
};

export const i18nConfigs: Linter.Config[] = [
  {
    name: '@astroscope/i18n',
    plugins: {
      '@astroscope/i18n': i18nPlugin,
    },
    rules: {
      '@astroscope/i18n/t-import-source': 'error',
      '@astroscope/i18n/no-module-level-t': 'error',
      '@astroscope/i18n/t-static-key': 'error',
      '@astroscope/i18n/t-static-meta': 'warn',
      '@astroscope/i18n/t-requires-meta': 'warn',
      '@astroscope/i18n/no-t-reassign': 'error',
      '@astroscope/i18n/prefer-x-directives': 'error',
      '@astroscope/i18n/no-raw-strings-in-jsx': 'warn',
    },
  },
];
