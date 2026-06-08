// -----------------------------------------------------------------------------
// Vercel Serverless Function のエントリ (コミット対象)。
//
// 実体は scripts/build-server.mjs が esbuild で生成する単一バンドル
// (../server-bundle/index.js) で、@trakon/db / @trakon/shared をインライン化済み。
// その default は Hono の Web ハンドラ (handle(app) = (req: Request) => Response)。
//
// ここで「名前付き HTTP メソッド export」(GET/POST/...) として公開することで、Vercel の
// Node ランタイムが **Web ハンドラ**として実行する。リクエスト body は Vercel が Web Request に
// 正しく載せるため、@hono/node-server の Node ストリーム読み取りで body 付き POST が滞留する
// 問題を回避できる。型は server-bundle/index.d.ts で与え、実体 .js は buildCommand で生成。
// -----------------------------------------------------------------------------
import handler from '../server-bundle/index.js';

export const config = {
  runtime: 'nodejs',
  regions: ['hnd1'],
};

// 関数到達/メソッドを確定するための最小ログ (障害切り分け用)。
const wrap = (req: Request): Response | Promise<Response> => {
  console.log(`[fn] ${req.method} ${new URL(req.url).pathname}`);
  return handler(req);
};

export const GET = wrap;
export const POST = wrap;
export const PUT = wrap;
export const PATCH = wrap;
export const DELETE = wrap;
export const OPTIONS = wrap;
export const HEAD = wrap;
