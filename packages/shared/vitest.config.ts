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
      // 固定の下限（現状 ~93% / branches ~92%）。環境差の余裕を持たせる。
      thresholds: {
        lines: 88,
        functions: 95,
        branches: 85,
        statements: 88,
      },
    },
  },
});