const js = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const prettier = require('eslint-config-prettier');
const security = require('eslint-plugin-security');
const globals = require('globals');

const typescriptFiles = ['**/*.ts'];

module.exports = [
  {
    ignores: ['coverage/**', 'dist/**', 'node_modules/**'],
  },
  {
    files: typescriptFiles,
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: js.configs.recommended.rules,
  },
  ...tseslint.configs['flat/recommended'].map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
  {
    ...security.configs.recommended,
    files: typescriptFiles,
  },
  {
    ...prettier,
    files: typescriptFiles,
  },
  {
    files: typescriptFiles,
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      'no-console': 'warn',
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-object-injection': 'error',
    },
  },
  {
    files: [
      'main.ts',
      'scripts/**/*.ts',
      'src/cli.ts',
      'src/cli-helpers.ts',
      'src/tests/**/*.ts',
      'tests/**/*.ts',
    ],
    rules: {
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
];
