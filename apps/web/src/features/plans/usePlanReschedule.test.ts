import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createElement } from 'react';

import { server } from '@/test/handlers';
import { createTestQueryClient } from '@/test/render';
import { plansQueryKey } from './api';
import { useReschedulePlan, type ReschedulePatch } from './usePlanReschedule';

// supabase をモックして apiRequest の Authorization 注入を回避する。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

// toast の副作用を排除しつつ呼び出しを観測する。
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

const PROJECT_ID = 'p1';

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

function planUrl(itemId: string, planId: string) {
  return `*/api/v1/projects/${PROJECT_ID}/items/${itemId}/plans/${planId}`;
}

const patches: ReschedulePatch[] = [
  { itemId: 'it1', planId: 'pl1', patch: { scheduledDate: '2026-06-22' } },
  { itemId: 'it2', planId: 'pl2', patch: { scheduledDate: '2026-06-23' } },
];

beforeEach(() => {
  client = createTestQueryClient();
  toastError.mockReset();
  toastSuccess.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useReschedulePlan', () => {
  it('複数プランを順次 PATCH し、成功トーストと一覧無効化を行う', async () => {
    const calledPaths: string[] = [];
    server.use(
      http.patch(planUrl('it1', 'pl1'), ({ request }) => {
        calledPaths.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: { id: 'pl1' } });
      }),
      http.patch(planUrl('it2', 'pl2'), ({ request }) => {
        calledPaths.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: { id: 'pl2' } });
      }),
    );

    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useReschedulePlan(PROJECT_ID), { wrapper });

    act(() => {
      result.current.mutate(patches);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 2 件とも PATCH された。
    expect(calledPaths).toHaveLength(2);
    expect(toastSuccess).toHaveBeenCalledWith('日程を更新しました');
    // projectList + per-item 一覧 (2 件) を無効化。
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: plansQueryKey.projectList(PROJECT_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: plansQueryKey.list(PROJECT_ID, 'it1'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: plansQueryKey.list(PROJECT_ID, 'it2'),
    });
  });

  it('PATCH が失敗するとエラートーストを出し、無効化は実行する', async () => {
    server.use(
      http.patch(planUrl('it1', 'pl1'), () =>
        HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: '日付が不正です' } },
          { status: 422 },
        ),
      ),
    );

    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useReschedulePlan(PROJECT_ID), { wrapper });

    act(() => {
      result.current.mutate([patches[0]!]);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('日付が不正です');
    // onSettled は失敗時も走る。
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: plansQueryKey.projectList(PROJECT_ID),
    });
  });
});
