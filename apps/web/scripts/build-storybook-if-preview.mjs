// Vercel Preview デプロイでのみ Storybook 静的ビルドを dist/storybook に追加する。
// Production (`vercel build --prod`) やローカルの `pnpm build` (VERCEL_ENV 未設定) では
// スキップし、通常のビルド時間・出力に影響を与えない。
import { execSync } from 'node:child_process';

const vercelEnv = process.env.VERCEL_ENV;

if (vercelEnv !== 'preview') {
  console.log(
    `[build-storybook-if-preview] VERCEL_ENV=${vercelEnv ?? '(unset)'} — skipping Storybook build (only runs when VERCEL_ENV=preview).`,
  );
  process.exit(0);
}

console.log('[build-storybook-if-preview] VERCEL_ENV=preview — building Storybook into dist/storybook ...');
execSync('pnpm exec storybook build --output-dir dist/storybook', { stdio: 'inherit' });
