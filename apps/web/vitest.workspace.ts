import { defineWorkspace } from 'vitest/config';
import path from 'node:path';
import react from '@vitejs/plugin-react';

// テストは 3 プロジェクトに分割する。
//   - web-client            : FE (jsdom + React + MSW)。`src/**/*.test.{ts,tsx}`
//   - web-server-unit       : BE ユニット (node, Prisma モック)。`server/**/*.test.ts`
//   - web-server-integration: BE 統合 (node, 実テスト DB)。`server/**/*.integration.test.ts`
// カバレッジ等のグローバル設定は vitest.config.ts 側に置く。
const alias = { '@': path.resolve(__dirname, './src') };

export default defineWorkspace([
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      name: 'web-client',
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  },
  {
    resolve: { alias },
    test: {
      name: 'web-server-unit',
      environment: 'node',
      globals: true,
      include: ['server/**/*.test.ts'],
      exclude: ['server/**/*.integration.test.ts'],
    },
  },
  {
    resolve: { alias },
    test: {
      name: 'web-server-integration',
      environment: 'node',
      globals: true,
      include: ['server/**/*.integration.test.ts'],
      setupFiles: ['./server/test/integration.setup.ts'],
      // 実 DB を共有するため、ファイル間並列を無効化し単一プロセスで直列実行する。
      // (並列だと各ファイルの beforeEach TRUNCATE が衝突しデッドロック/データ消失する)
      fileParallelism: false,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  },
]);
