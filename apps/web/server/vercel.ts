// Web 標準 (Request) => Response 形式のハンドラ。Vercel では api/index.ts 側で
// 「名前付き HTTP メソッド export」として公開し、Vercel ネイティブの Web ハンドラとして動かす。
// これにより body 付き POST のリクエストボディは Vercel 側が正しく Web Request に載せる
// (@hono/node-server の Node ストリーム読み取りを介さないため、body 付き POST の滞留を回避)。
import { handle } from 'hono/vercel';

import { app } from './app.js';

export default handle(app);
