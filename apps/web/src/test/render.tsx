import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

/** テスト用 QueryClient (リトライ無効で失敗を即時反映)。 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * QueryClientProvider + MemoryRouter でラップして描画する。
 * route で初期 URL を指定できる。queryClient を差し替えたい場合は client を渡す。
 */
export function renderWithProviders(
  ui: ReactElement,
  opts: { route?: string; client?: QueryClient } = {},
): ReturnType<typeof render> {
  const queryClient = opts.client ?? createTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[opts.route ?? '/']}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}
