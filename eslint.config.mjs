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
      // wrangler's local Worker state and build output (FND-09 relay tests).
      '**/.wrangler/**',
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
    // Repository scripts run in Node (docs/runbooks/local-gate.md).
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
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
    // a patient link is the patients' sign in (IAM-09): the signed token is checked first. A clinic
    // tablet's cookie is its sign in (IAM-10): the token's hash finds the tablet. Rate limit counters
    // (IAM-11) are bookkeeping no person drives. The health form's submit pipeline (INT-10) runs
    // as the system after the patient's own submit, and from its job. The blind test (AI-06) is
    // an operator's command line tool, with no person signed in, as is submitting the WhatsApp
    // templates to Meta (WA-06) and writing patient content drafts (AI-07). Meta's WhatsApp
    // webhook (WA-02)
    // and the booking Flow's data endpoint (WA-04) are signed by Meta with the app secret, with no
    // person signed in.
    files: [
      'apps/web/app/api/whatsapp/**',
      'apps/web/app/api/flows/**',
      'apps/web/scripts/blind-test.ts',
      'apps/web/scripts/patient-content.ts',
      'apps/web/scripts/whatsapp-templates.ts',
      'apps/web/modules/intake/pipeline.ts',
      'apps/web/proxy.ts',
      'apps/web/lib/**',
      'apps/web/modules/auth/**',
      'apps/web/modules/patient-links/**',
      'apps/web/modules/kiosk/**',
      'apps/web/modules/rate-limits/**',
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
    // Backups (FND-13): an operator's command line tool. Every path it reads or writes is one the
    // operator or the backup workflow passes in, or a folder under it; none comes from a request.
    files: ['packages/db/src/backup/**'],
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  },
  {
    // The blind test (AI-06): an operator's command line tool. Every path it reads or writes is a
    // file or folder the operator passes in, or one under that folder; none comes from a request.
    files: ['apps/web/modules/ai/blind-test*.ts', 'apps/web/scripts/blind-test.ts'],
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  },
  {
    // Test visits start with earlierToday, never now give or take some minutes: the database
    // checks visits in and starts them on their own IST day only, so such a visit falls on another
    // day near midnight and the test fails or skips (docs/runbooks/local-gate.md, "Time of day").
    files: ['**/*.test.ts', 'apps/web/e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ":matches(VariableDeclarator[id.name='startsAt'], Property[key.name='startsAt']) > NewExpression[callee.name='Date'] CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'Start a test visit with earlierToday(minutes) from @clinic-mx/schemas, so it stays on today in IST.',
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
