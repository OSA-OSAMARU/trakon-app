import { setupServer } from 'msw/node';

// 既定ハンドラは空。各テストで `server.use(http.get('*/api/v1/...', ...))` を使って
// 必要なエンドポイントだけモックする。未登録リクエストは onUnhandledRequest='error' で検出。
export const server = setupServer();
