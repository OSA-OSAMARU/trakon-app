// scripts/build-server.mjs が生成する server-bundle/index.js の型宣言 (コミット対象)。
// 実体の .js は gitignore されビルド時に生成される。default export は Vercel の
// Hono の Web ハンドラ (hono/vercel の handle() の戻り値 = (req: Request) => Response)。
declare const handler: (req: Request) => Response | Promise<Response>;
export default handler;
