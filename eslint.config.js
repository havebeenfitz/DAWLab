import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'release', 'node_modules', '*.config.js', '*.config.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // The rules of hooks and effect dependencies, as before.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // This codebase intentionally types on-disk VCS log/registry objects as
      // `any` (dynamic, schema-versioned JSON). Enforcing explicit types here
      // would mean hundreds of casts with no safety gain.
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow deliberately-unused args/vars when prefixed with `_` (e.g. `_ev`,
      // `_event`), the convention already used across the IPC handlers.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Empty `catch {}` is a deliberate "best-effort, ignore failure" pattern here.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Vitest hoists `vi.mock`/`vi.hoisted` factories above imports, so these
    // files must use `require()` inside them: imports aren't available yet.
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
