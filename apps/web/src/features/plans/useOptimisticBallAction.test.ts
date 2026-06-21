import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createElement } from 'react';

import { server } from '@/test/handlers';
import { createTestQueryClient } from '@/test/render';
import { plansQueryKey, type Plan } from './api';
import { useTossPlan, useCompletePlan } from './useOptimisticBallAction';

// supabase をモックして apiRequest の Authorization 注入を回避する。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

// toast の副作用 (DOM / タイマー) を排除しつつ呼び出しを観測する。
const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastMessage = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    message: (...a: unknown[]) => toastMessage(...a),
  },
}));

const PROJECT_ID = 'p1';
const ITEM_ID = 'it1';
const PLAN_ID = 'pl1';

const fromMember = {
  id: 'mFrom',
  name: '発注者',
  organizationName: 'Org',
  memberType: 'client' as const,
};
const toMember = {
  id: 'mTo',
  name: '制作者',
  organizationName: 'Org',
  memberType: 'production' as const,
};

function makePlan(): Plan {
  // ball がまだ from にある ready 状態のプラン。
  return {
    id: PLAN_ID,
    itemId: ITEM_ID,
    planType: 'toss',
    title: 'デザイン',
    category: 'design',
    scheduledDate: '2026-06-21',
    dueDate: null,
    fromMember,
    toMember,
    successorPlanId: null,
    status: 'active',
    memo: null,
    ballHolder: fromMember,
    ballState: 'ready',
    latestEvent: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

function seedList(plan: Plan) {
  client.setQueryData<Plan[]>(plansQueryKey.list(PROJECT_ID, ITEM_ID), [plan]);
}

function getList(): Plan[] | undefined {
  return client.getQueryData<Plan[]>(plansQueryKey.list(PROJECT_ID, ITEM_ID));
}

/**
 * 一覧キャッシュの遷移を記録する。onSettled の invalidate + gcTime:0 で
 * クエリが GC される前に楽観更新値を捕捉できるよう、cache subscribe で蓄積する。
 */
function recordListSnapshots(): Plan[][] {
  const snapshots: Plan[][] = [];
  const push = () => {
    const list = getList();
    if (list) snapshots.push(list);
  };
  client.getQueryCache().subscribe(push);
  return snapshots;
}

const tossUrl = `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/toss`;
const completeUrl = `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/complete`;

beforeEach(() => {
  client = createTestQueryClient();
  toastError.mockReset();
  toastSuccess.mockReset();
  toastMessage.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useTossPlan', () => {
  it('onMutate でキャッシュを楽観更新し、成功時にコミットする', async () => {
    seedList(makePlan());
    const snapshots = recordListSnapshots();
    server.use(
      http.post(tossUrl, () =>
        HttpResponse.json({ data: { plan: makePlan(), autoTossed: null } }),
      ),
    );

    const { result } = renderHook(
      () => useTossPlan({ projectId: PROJECT_ID, itemId: ITEM_ID, planId: PLAN_ID }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 楽観更新: ball が to へ移り state=tossed になった瞬間を捕捉する。
    const optimistic = snapshots.find((s) => s[0]?.ballState === 'tossed')?.[0];
    expect(optimistic).toBeDefined();
    expect(optimistic?.ballHolder?.id).toBe('mTo');
    expect(optimistic?.latestEvent?.id).toBe('optimistic');
    expect(toastSuccess).toHaveBeenCalledWith('TOSS しました');
  });

  it('エラー時に onError でキャッシュをロールバックする', async () => {
    seedList(makePlan());
    const snapshots = recordListSnapshots();
    server.use(
      http.post(tossUrl, () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'すでに TOSS 済み' } },
          { status: 409 },
        ),
      ),
    );

    const { result } = renderHook(
      () => useTossPlan({ projectId: PROJECT_ID, itemId: ITEM_ID, planId: PLAN_ID }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // 一度は楽観更新 (tossed) され、その後 ready へロールバックされた遷移を確認する。
    expect(snapshots.some((s) => s[0]?.ballState === 'tossed')).toBe(true);
    const rolledBack = snapshots[snapshots.length - 1]![0];
    expect(rolledBack?.ballState).toBe('ready');
    expect(rolledBack?.ballHolder?.id).toBe('mFrom');
    expect(rolledBack?.latestEvent).toBeNull();
    expect(toastError).toHaveBeenCalledWith('すでに TOSS 済み');
  });
});

describe('useCompletePlan', () => {
  it('楽観更新で status=completed になり、成功時に autoTossed トーストを出す', async () => {
    seedList(makePlan());
    const snapshots = recordListSnapshots();
    server.use(
      http.post(completeUrl, () =>
        HttpResponse.json({ data: { plan: makePlan(), autoTossed: makePlan() } }),
      ),
    );

    const { result } = renderHook(
      () => useCompletePlan({ projectId: PROJECT_ID, itemId: ITEM_ID, planId: PLAN_ID }),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 楽観更新で completed + status=completed になった瞬間を捕捉する。
    const optimistic = snapshots.find((s) => s[0]?.ballState === 'completed')?.[0];
    expect(optimistic).toBeDefined();
    expect(optimistic?.status).toBe('completed');
    expect(toastSuccess).toHaveBeenCalledWith('完了しました');
    expect(toastMessage).toHaveBeenCalledWith('後続の予定に自動 TOSS しました');
  });

  it('エラー時にロールバックして失敗トーストを出す', async () => {
    seedList(makePlan());
    const snapshots = recordListSnapshots();
    server.use(
      http.post(completeUrl, () =>
        HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: '完了できません' } },
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHook(
      () => useCompletePlan({ projectId: PROJECT_ID, itemId: ITEM_ID, planId: PLAN_ID }),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // 一度は completed に楽観更新され、その後 active/ready へロールバックされる。
    expect(snapshots.some((s) => s[0]?.status === 'completed')).toBe(true);
    const rolledBack = snapshots[snapshots.length - 1]![0];
    expect(rolledBack?.status).toBe('active');
    expect(rolledBack?.ballState).toBe('ready');
    expect(toastError).toHaveBeenCalledWith('完了できません');
  });
});
