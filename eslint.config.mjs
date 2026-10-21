import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import js from '@eslint/js';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig } from 'eslint/config';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
const WEB_FILES = ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'];

// Next's React, hooks, accessibility and Core Web Vitals rules, limited to the web app.
const nextForWeb = nextCoreWebVitals.map((config) => ({
  ...config,
  files: config.files ? config.files.map((pattern) => `apps/web/${pattern}`) : WEB_FILES,
}));

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
      'docs/**',
      '.claude/**',
      '.gstack/**',
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  security.configs.recommended,
  comments.recommended,
  nextForWeb,
  {
    files: WEB_FILES,
    settings: { next: { rootDir: 'apps/web' } },
  },
  {
    files: TS_FILES,
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Rule 14: no `any`. A justified exception needs a disable comment with a reason.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // eslint-config-next sets a Babel parser for JavaScript files; use the TypeScript
    // parser (without type information) so ESLint 10's scope manager API is available.
    files: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    languageOptions: { parser: tseslint.parser },
  },
  {
    // The service worker runs in the browser's service worker scope, not the page or Node.
    files: ['apps/web/public/sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },
  {
    // Rule 17, IAM-04: every write in the web app goes through staffService, which checks the
    // permission map before it opens the audited transaction. Writing around it is refused.
    files: WEB_FILES,
    ignores: ['apps/web/modules/access/service.ts', 'apps/web/e2e/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@clinic-mx/db',
              importNames: ['withActor', 'setAuditContext', 'updateSetting', 'updateVersioned'],
              message:
                'Write through staffService (apps/web/modules/access/service.ts): permission, validate, transaction, audit.',
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      eqeqeq: ['error', 'always'],
      // Every disable comment must say why (rule 14).
      '@eslint-community/eslint-comments/require-description': 'error',
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      // Flags every obj[key] lookup; too many false positives to be useful.
      'security/detect-object-injection': 'off',
    },
  },
);
