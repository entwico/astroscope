import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ESLint, Linter } from 'eslint';
import { noModuleLevelT } from './rules/no-module-level-t.js';
import { DEFAULT_IGNORE_ATTRIBUTES, noRawStringsInJsx } from './rules/no-raw-strings-in-jsx.js';
import { noTReassign } from './rules/no-t-reassign.js';
import { preferXDirectives } from './rules/prefer-x-directives.js';
import { tImportSource } from './rules/t-import-source.js';
import { tRequiresMeta } from './rules/t-requires-meta.js';
import { tStaticKey } from './rules/t-static-key.js';
import { tStaticMeta } from './rules/t-static-meta.js';

const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'));

const plugin: ESLint.Plugin & { configs: Record<string, Linter.Config> } = {
  meta: {
    name: '@astroscope/eslint-plugin-i18n',
    version: pkg.version,
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
  configs: {},
};

plugin.configs.recommended = {
  plugins: {
    '@astroscope/i18n': plugin,
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
} satisfies Linter.Config;

export { DEFAULT_IGNORE_ATTRIBUTES };

export default plugin;
