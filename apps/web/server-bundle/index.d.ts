// scripts/build-server.mjs が生成する server-bundle/index.js の型宣言 (コミット対象)。
// 実体の .js は gitignore されビルド時に生成される。default export は Vercel の
// Node ランタイム向け Hono ハンドラ (@hono/node-server/vercel の handle() の戻り値 =
// (req, res) => void の Node リスナー)。
declare const handler: (...args: unknown[]) => unknown;
export default handler;
