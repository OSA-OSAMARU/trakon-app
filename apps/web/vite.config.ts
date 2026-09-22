import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import { buildVersionString } from './src/lib/appVersion';

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3001);

/**
 * semver の正は **apps/web/package.json の version** (#248)。
 *
 * リリースタグ (`v1.2.3`) との一致は release-deploy.yml が公開時に検証し、
 * ずれていたらデプロイを止める。画面に出る番号とリポジトリが名乗る番号が
 * 食い違わないことを、運用の約束ではなく仕組みで担保する。
 */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** ビルド元のコミット。Vercel は環境変数、ローカルは git から引く。取れなければ ''。 */
function commitSha(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

/**
 * 画面に出すビルド識別子 (#195 / #248)。**どの環境でも semver で出す。**
 *   - Production … release-deploy.yml が渡すリリースタグ (`1.2.3`)
 *   - それ以外   … package.json の version + ビルド元コミット
 *                  (`1.2.3-dev+517e233`)
 *
 * 組み立ての規則そのものは src/lib/appVersion.ts の buildVersionString に置いて
 * ある (テストできるようにするため)。ここは node から値を集めるだけ。
 */
const appVersion = buildVersionString({
  releaseTag: process.env.VITE_APP_VERSION,
  packageVersion: packageVersion(),
  commitSha: commitSha(),
});

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
  // テスト設定は vitest.config.ts に委譲（projects 分割 + カバレッジ）。
});
