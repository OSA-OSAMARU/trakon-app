import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3001);

/**
 * 画面に出すビルド識別子を決める (#195)。詳細は src/lib/appVersion.ts。
 *
 * Production は release-deploy.yml が VITE_APP_VERSION にリリースタグを入れる。
 * Preview は Vercel が VERCEL_GIT_COMMIT_SHA を入れるのでコミットで示す。
 * ローカルは git から引く。どれも取れなければ 'unknown' で落とす (ビルドは止めない)。
 */
function resolveAppVersion(): { version: string; isRelease: boolean } {
  const tag = process.env.VITE_APP_VERSION?.trim();
  if (tag) return { version: tag, isRelease: true };

  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (sha) return { version: sha.slice(0, 7), isRelease: false };

  try {
    return {
      version: execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim(),
      isRelease: false,
    };
  } catch {
    return { version: 'unknown', isRelease: false };
  }
}

const appVersion = resolveAppVersion();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion.version),
    __APP_VERSION_IS_RELEASE__: JSON.stringify(appVersion.isRelease),
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
