import { defineConfig } from 'vitest/config';

// @trakon/shared のテスト + カバレッジ設定。
// ドメインロジック（domain/ballHolder.ts 等）が主対象。閾値は autoUpdate で ratchet。
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/index.ts', 'src/**/index.ts', '**/*.d.ts'],
      thresholds: {
        autoUpdate: true,
        lines: 93.75,
        functions: 100,
        branches: 92.85,
        statements: 93.75,
      },
    },
  },
});