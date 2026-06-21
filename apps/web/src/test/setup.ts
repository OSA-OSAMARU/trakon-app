import '@testing-library/jest-dom/vitest';

import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './handlers';

// MSW: FE のテストでは API を実ネットワークではなく MSW でモックする。
// 未登録のリクエストはテストの取りこぼしを防ぐためエラーにする。
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
