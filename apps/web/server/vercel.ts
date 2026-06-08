// Vercel の Node ランタイム用アダプタ。hono/vercel (Edge 用, fetch 形式) ではなく
// @hono/node-server/vercel (Node の (req,res) 形式 = getRequestListener) を使う。
// 前者は Node の IncomingMessage を app.fetch に渡すため URL が壊れて 404 になり、
// 返り値 Response も Node ランタイムに無視されてレスポンス未送出 → 30s で 504 になる。
import { handle } from '@hono/node-server/vercel';

import { app } from './app.js';

export const config = {
  runtime: 'nodejs',
  regions: ['hnd1'],
};

export default handle(app);
