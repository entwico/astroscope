import pluginJs from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import eslintPluginAstro from 'eslint-plugin-astro';
import importPlugin from 'eslint-plugin-import-x';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

export default [
  // global ignores
  { ignores: ['**/dist/*', '**/node_modules/*', '**/.astro/*'] },

  // standard js rules
  pluginJs.configs.recommended,

  // override js rules
  {
    rules: {
      semi: [2, 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'always'],
      quotes: ['error', 'single'],
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1 }],
      'object-shorthand': 'error',
      'no-useless-concat': 'error',
      'prefer-template': 'error',
      'sort-imports': [
        'error',
        {
          ignoreCase: false,
          ignoreDeclarationSort: true, // Let import/order handle declaration sorting
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
          allowSeparatedGroups: false,
        },
      ],
    },
  },

  // standard typescript rules
  ...tseslint.configs.recommended,

  // override typescript rules (non-type-aware)
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': 0,
      '@typescript-eslint/explicit-module-boundary-types': 0,
      '@typescript-eslint/no-empty-function': 0,
      '@typescript-eslint/no-unused-expressions': 0,
      '@typescript-eslint/no-empty-interface': 0,
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // type-aware rules only for .ts/.tsx files (not .astro)
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          disallowTypeAnnotations: true,
          fixStyle: 'inline-type-imports',
        },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },

  // astro rules - configure TypeScript parser for frontmatter
  ...eslintPluginAstro.configs.recommended.map((config) => ({
    ...config,
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...config.languageOptions?.parserOptions,
        parser: tsParser,
      },
    },
  })),

  // astro a11y rules (includes jsx-a11y plugin)
  ...eslintPluginAstro.configs['jsx-a11y-strict'],

  // prettier rules
  prettierRecommended,

  // disable prettier for astro files (prettier-plugin-astro has issues with TypeScript in scripts)
  // this must come AFTER prettierRecommended to override
  {
    // `**/*.astro/*` also covers the `<script>` blocks the astro processor extracts as
    // virtual files — prettier mis-parses statement bodies in those, so keep it off there too
    files: ['**/*.astro', '**/*.astro/*'],
    rules: {
      'prettier/prettier': 'off',
      'prefer-template': 'off', // astro inline scripts use string concat
    },
  },

  // import rules
  {
    ...importPlugin.flatConfigs.recommended,
    rules: {
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'parent', 'sibling', 'index'],
          alphabetize: {
            order: 'asc',
          },
        },
      ],
    },
  },
];
