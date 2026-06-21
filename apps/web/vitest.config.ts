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
      // 閾値は「現状値より少し低い固定の下限」とし、目標 80% へ手動で段階的に引き上げる。
      // autoUpdate は使わない: 実測ぴったりを下限にすると CI と僅かな環境差で落ちるため。
      thresholds: {
        // BE ユニット（目標 80%）— 現状 ~26.5% / branches ~69%
        'server/**': { lines: 24, functions: 35, branches: 65, statements: 24 },
        // FE（ユニット + MSW 統合の合算、目標 80%）— 現状 ~6.8% / branches ~52%
        'src/**': { lines: 6, functions: 40, branches: 45, statements: 6 },
      },
    },
  },
});