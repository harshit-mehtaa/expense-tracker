/**
 * The `lint` script and its plugins were already in package.json, but no config file
 * existed anywhere, so `eslint` failed on invocation and nothing was ever linted.
 * This is the missing piece.
 */
module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'coverage', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-refresh'],
  rules: {
    // Deferred, not endorsed: 180 existing sites, concentrated in report/chart row
    // mapping. Enabling it now would make the gate unadoptable. Tighten once those
    // are typed — the rules that catch bugs are the ones kept on below.
    '@typescript-eslint/no-explicit-any': 'off',

    // Underscore prefix is the codebase's marker for a deliberately unused binding
    // (e.g. indianFormat.ts formatINR's _forcePaise).
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],

    // Context files intentionally export their hook alongside the provider. This rule
    // only affects fast-refresh granularity, not correctness.
    'react-refresh/only-export-components': 'off',

    // Kept as errors — these catch real defects. rules-of-hooks found a conditional
    // useMemo in Transactions.tsx that would have crashed the page after loading.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  overrides: [
    {
      // Vitest globals (globals: true in vite.config.ts).
      files: ['src/__tests__/**/*.{ts,tsx}'],
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  ],
};
