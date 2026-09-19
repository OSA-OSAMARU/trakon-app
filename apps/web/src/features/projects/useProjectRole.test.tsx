import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { server } from '@/test/handlers';
import { createTestQueryClient } from '@/test/render';

import { useProjectRole } from './useProjectRole';

/**
 * ロール別の操作可否は packages/shared のマトリクスが単一の根拠。
 * ここで見るのは「フックがそのマトリクスへ正しく橋渡ししているか」だけ。
 */
function stubProjectRole(role: string) {
  server.use(
    http.get('*/api/v1/projects/p1', () =>
      HttpResponse.json({ data: { id: 'p1', name: 'テスト案件', role } }),
    ),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useProjectRole', () => {
  it('管理者は予定の削除も TOSS もできる', async () => {
    stubProjectRole('admin');
    const { result } = renderHook(() => useProjectRole('p1'), { wrapper });

    await waitFor(() => expect(result.current.role).toBe('admin'));
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.can('plan.delete')).toBe(true);
    // 管理者はボール保持者でなくても TOSS できる
    expect(result.current.canBall('plan.toss', false)).toBe(true);
  });

  it('編集者は予定を触れるが TOSS はできない', async () => {
    stubProjectRole('editor');
    const { result } = renderHook(() => useProjectRole('p1'), { wrapper });

    await waitFor(() => expect(result.current.role).toBe('editor'));
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.can('plan.update')).toBe(true);
    expect(result.current.canBall('plan.toss', true)).toBe(false);
  });

  it('閲覧者は予定を作れないが、自分が保持しているボールは進められる', async () => {
    stubProjectRole('viewer');
    const { result } = renderHook(() => useProjectRole('p1'), { wrapper });

    await waitFor(() => expect(result.current.role).toBe('viewer'));
    expect(result.current.can('plan.create')).toBe(false);
    expect(result.current.canBall('plan.complete', true)).toBe(true);
    expect(result.current.canBall('plan.complete', false)).toBe(false);
  });

  it('projectId 未確定のうちは何も許可しない', () => {
    const { result } = renderHook(() => useProjectRole(undefined), { wrapper });

    expect(result.current.role).toBeNull();
    expect(result.current.can('project.view')).toBe(false);
    expect(result.current.canBall('plan.toss', true)).toBe(false);
  });
});
