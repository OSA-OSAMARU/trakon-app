// scripts/build-server.mjs が生成する server-bundle/index.js の型宣言 (コミット対象)。
// 実体の .js は gitignore されビルド時に生成される。default export は Vercel の
// Node ランタイム向け Hono ハンドラ (hono/vercel の handle() の戻り値)。
declare const handler: (request: Request) => Response | Promise<Response>;
export default handler;
