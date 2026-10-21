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
    // permission map before it opens the audited transaction. Rule 10, IAM-05: staff reads run
    // under row level security (asStaff); the owner connection (appDb) is for system work only.
    files: WEB_FILES,
    ignores: ['apps/web/modules/access/**', 'apps/web/e2e/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@clinic-mx/db',
              importNames: [
                'withActor',
                'withStaffAccess',
                'setAuditContext',
                'updateSetting',
                'updateVersioned',
              ],
              message:
                'Write through staffService (apps/web/modules/access/service.ts): permission, validate, transaction, audit.',
            },
          ],
          patterns: [
            {
              group: ['**/lib/db'],
              importNames: ['appDb'],
              message:
                'Read as the staff member with asStaff (apps/web/modules/access/staff-db.ts), under row level security. appDb is for system work.',
            },
          ],
        },
      ],
    },
  },
  {
    // System work on the owner connection (IAM-05): sign in and its audit events, the token
    // claims check, the settings reader and jobs. No person drives these reads directly. Opening
    // a patient link is the patients' sign in (IAM-09): the signed token is checked first.
    files: [
      'apps/web/proxy.ts',
      'apps/web/lib/**',
      'apps/web/modules/auth/**',
      'apps/web/modules/patient-links/**',
      'apps/web/modules/settings/**',
      'apps/web/modules/jobs/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@clinic-mx/db',
              importNames: [
                'withActor',
                'withStaffAccess',
                'setAuditContext',
                'updateSetting',
                'updateVersioned',
              ],
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
