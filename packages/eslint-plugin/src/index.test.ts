import { readdirSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ESLint, Linter } from 'eslint';
import { describe, expect, test } from 'vitest';
import plugin, { i18nPlugin, wormholePlugin } from './index.js';

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'rules');

// the rule set a folder under `rules` belongs to
const PLUGINS: Record<string, ESLint.Plugin> = {
  '.': plugin,
  i18n: i18nPlugin,
  wormhole: wormholePlugin,
};

type RuleFile = { id: string; folder: string; rules: unknown[] };

function isRule(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'meta' in value && 'create' in value && typeof value.create === 'function';
}

/** every source file under `rules` with the rule modules it exports; helper modules export none */
async function loadRuleFiles(): Promise<RuleFile[]> {
  const files = readdirSync(RULES_DIR, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));

  return Promise.all(
    files.map(async (file) => {
      const exports = (await import(pathToFileURL(join(RULES_DIR, file)).href)) as Record<string, unknown>;

      return {
        id: basename(file, '.ts'),
        folder: relative(RULES_DIR, dirname(join(RULES_DIR, file))) || '.',
        rules: Object.values(exports).filter((value) => isRule(value)),
      };
    }),
  );
}

describe('plugin', () => {
  test('every rule file is registered under its file name in the rule set of its folder', async () => {
    const loaded = await loadRuleFiles();
    const ruleFiles = loaded.filter(({ rules }) => rules.length > 0);

    expect(ruleFiles.length).toBeGreaterThan(0);

    for (const { id, folder, rules } of ruleFiles) {
      expect(rules, `${folder}/${id} exports one rule`).toHaveLength(1);
      expect(PLUGINS[folder]?.rules?.[id], `${folder}/${id} is registered`).toBe(rules[0]);
    }
  });

  test('every registered rule comes from a rule file', async () => {
    const ruleFiles = await loadRuleFiles();

    for (const [folder, { rules = {} }] of Object.entries(PLUGINS)) {
      const ids = ruleFiles.filter((file) => file.folder === folder && file.rules.length > 0).map(({ id }) => id);

      expect(new Set(Object.keys(rules))).toEqual(new Set(ids));
    }
  });

  test('every rule a shipped config names exists in the plugin the config registers', () => {
    const configs = Object.values(plugin.configs).flatMap((config) => config as Linter.Config | Linter.Config[]);
    const named = configs.flatMap((config) => Object.keys(config.rules ?? {}).map((name) => ({ name, config })));

    expect(named.length).toBeGreaterThan(0);

    for (const { name, config } of named) {
      const separator = name.lastIndexOf('/');
      const registered = config.plugins?.[name.slice(0, separator)];

      expect(registered?.rules?.[name.slice(separator + 1)], `${config.name}: ${name}`).toBeDefined();
    }
  });
});
