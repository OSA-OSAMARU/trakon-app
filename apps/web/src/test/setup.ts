import '@testing-library/jest-dom/vitest';

import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './handlers';

// MSW: FE のテストでは API を実ネットワークではなく MSW でモックする。
// 未登録のリクエストはテストの取りこぼしを防ぐためエラーにする。
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * React 18 では素の関数コンポーネントに渡された ref はどこにも届かない (#230)。
 * この抜けは jsdom では症状が出ないため、`<DropdownMenuTrigger asChild><Button>` の
 * ref が切れていてもテストは緑のままで、実ブラウザでだけメニューが出なくなっていた。
 * 警告が出た時点でテストを落として、同じ壊れ方を二度通さない。
 */
const originalConsoleError = console.error;
console.error = (...args: Parameters<typeof console.error>) => {
  const [first] = args;
  if (typeof first === 'string' && first.includes('Function components cannot be given refs')) {
    throw new Error(
      `React が ref を破棄しました。対象のコンポーネントを React.forwardRef にしてください。\n${args.join(' ')}`,
    );
  }
  originalConsoleError(...args);
};
