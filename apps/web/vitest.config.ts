import { defineConfig } from 'vitest/config';

// グローバルなテスト設定（カバレッジ）。プロジェクト分割は vitest.workspace.ts を参照。
// カバレッジは glob 別閾値で BE(server/**) と FE(src/**) を分離して計測する。
// 閾値は autoUpdate で現状値へ ratchet（退行のみ検知）し、目標 80% へは手動で引き上げる。
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.integration.test.ts',
        'src/test/**',
        'server/test/**',
        'src/components/ui/**', // shadcn/ui 取り込み（一部 lint 免除対象）
        'src/main.tsx',
        'server/vercel.ts',
        'server/dev.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        autoUpdate: true,
        // BE ユニット（目標 80%）
        'server/**': { lines: 26.59, functions: 38.31, branches: 69.63, statements: 26.59 },
        // FE（ユニット + MSW 統合の合算、目標 80%）
        'src/**': { lines: 6.8, functions: 44.61, branches: 52.17, statements: 6.8 },
      },
    },
  },
});