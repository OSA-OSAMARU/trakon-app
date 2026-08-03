/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: '18' },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'warn',
  },
  ignorePatterns: ['dist/', 'node_modules/', '.vercel/'],
  overrides: [
    {
      // shadcn 由来 UI primitives は元スタイル維持
      files: ['src/components/ui/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/consistent-type-imports': 'off',
        'react-refresh/only-export-components': 'off',
      },
    },
    {
      // Storybook 設定はコンポーネントでないオブジェクトを export する
      files: ['.storybook/**/*.{ts,tsx}'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
    {
      // Story ファイルは meta と複数の Story オブジェクトを export する
      files: ['**/*.stories.tsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
  ],
};
