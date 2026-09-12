import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.bootstrap-cache/**',
      '.local/**',
      '.tools/**',
      'coverage/**',
      '**/dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'output/**/_backup/**',
      'output/pfc-workbench-prototype/_backup/**',
      'output/**/original/**',
      'output/pfc-workbench-prototype/*.cjs',
      'output/pfc-workbench-prototype/*.mjs',
      'output/**/verify-*.mjs',
      'output/**/verify-*.cjs',
      'output/**/check-*.cjs',
      'output/**/_debug-*.cjs',
      // These exact historical files were already excluded at their old paths.
      'archive/prototype-v3-reference-20260912/prototype-v3.js',
      'archive/prototype-v3-reference-20260912/prototype-v3-data.js',
      'archive/prototype-v3-reference-20260912/verify-v3.mjs',
      'archive/prototype-v3-reference-20260912/verify-v3-check.cjs',
      'archive/prototype-v3-reference-20260912/verify-v3-gov.cjs',
      'archive/prototype-v3-reference-20260912/debug-gov-v3.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
);
