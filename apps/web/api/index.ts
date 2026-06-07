// -----------------------------------------------------------------------------
// Vercel Serverless Function のエントリ (コミット対象)。
//
// 実体は scripts/build-server.mjs が esbuild で生成する単一バンドル
// (../server-bundle/index.js) で、@trakon/db / @trakon/shared をインライン化済み。
// ここから re-export することで:
//   * Vercel の `functions` パターン (api/index.ts) がソース上で必ずマッチする
//     (生成物 .js をパターンにすると、ビルド前検証で「見つからない」エラーになる)
//   * @vercel/node はこの薄いエントリ + バンドル本体 (.js) のみを対象にするため、
//     本番 Node が生 .ts (@trakon/*) を読む問題が起きない。
//
// バンドルの型は server-bundle/index.d.ts (コミット済み) で与える。実体の .js は
// buildCommand (vite build && node scripts/build-server.mjs) で生成される。
// -----------------------------------------------------------------------------
export { default } from '../server-bundle/index.js';

export const config = {
  runtime: 'nodejs',
  regions: ['hnd1'],
};
