import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createElement } from 'react';

import { server } from '@/test/handlers';
import { createTestQueryClient } from '@/test/render';
import { plansQueryKey, type Plan } from './api';
import { useTossPlan, useApprovePlan } from './useOptimisticBallAction';

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

// 実施者 (executor)。in_progress のホルダー。
const executor = {
  id: 'mExec',
  name: '実施者',
  organizationName: 'Org',
  memberType: 'production' as const,
};
// 進行責任者 (progressManager)。approved のホルダー。TOSS 履歴の fromMember にも入る。
const progressManager = {
  id: 'mPm',
  name: '進行責任者',
  organizationName: 'Org',
  memberType: 'client' as const,
};
// TOSS 先の後続実施者 (toMember)。tossed のホルダー。
const toMember = {
  id: 'mTo',
  name: '後続実施者',
  organizationName: 'Org',
  memberType: 'production' as const,
};

/**
 * 承認済み (approved) のプラン。ボールは進行責任者にある。
 * - TOSS すると tossed へ移り、ホルダーは後続実施者 (toMember) へ。
 */
function makeApprovedPlan(): Plan {
  return {
    id: PLAN_ID,
    itemId: ITEM_ID,
    planType: 'toss',
    title: 'デザイン',
    category: 'design',
    colorTheme: null,
    scheduledDate: '2026-06-21',
    dueDate: null,
    executor,
    approver: null,
    progressManager,
    fromMember: progressManager,
    toMember,
    successorPlanId: null,
    status: 'active',
    memo: null,
    ballHolder: progressManager,
    ballState: 'approved',
    latestEvent: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/**
 * 実施中 (in_progress) のプラン。ボールは実施者にある。承認者なし。
 * - 承認 (approve) すると承認済みへ移り、後続が無いため status=completed になる。
 */
function makeInProgressPlan(): Plan {
  return {
    ...makeApprovedPlan(),
    ballHolder: executor,
    ballState: 'in_progress',
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
const approveUrl = `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/approve`;

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
    seedList(makeApprovedPlan());
    const snapshots = recordListSnapshots();
    server.use(
      http.post(tossUrl, () =>
        HttpResponse.json({ data: { plan: makeApprovedPlan(), autoTossed: null } }),
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

    // 楽観更新: ball が後続実施者 (toMember) へ移り state=tossed になった瞬間を捕捉する。
    const optimistic = snapshots.find((s) => s[0]?.ballState === 'tossed')?.[0];
    expect(optimistic).toBeDefined();
    expect(optimistic?.ballHolder?.id).toBe('mTo');
    expect(optimistic?.latestEvent?.id).toBe('optimistic');
    expect(toastSuccess).toHaveBeenCalledWith('TOSS しました');
  });

  it('エラー時に onError でキャッシュをロールバックする', async () => {
    seedList(makeApprovedPlan());
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

    // 一度は楽観更新 (tossed) され、その後 approved へロールバックされた遷移を確認する。
    expect(snapshots.some((s) => s[0]?.ballState === 'tossed')).toBe(true);
    const rolledBack = snapshots[snapshots.length - 1]![0];
    expect(rolledBack?.ballState).toBe('approved');
    expect(rolledBack?.ballHolder?.id).toBe('mPm');
    expect(rolledBack?.latestEvent).toBeNull();
    expect(toastError).toHaveBeenCalledWith('すでに TOSS 済み');
  });
});

describe('useApprovePlan', () => {
  it('楽観更新で承認済み (後続なし→status=completed) になり、成功トーストを出す', async () => {
    seedList(makeInProgressPlan());
    const snapshots = recordListSnapshots();
    server.use(
      http.post(approveUrl, () =>
        HttpResponse.json({ data: { plan: makeInProgressPlan(), autoTossed: null } }),
      ),
    );

    const { result } = renderHook(
      () => useApprovePlan({ projectId: PROJECT_ID, itemId: ITEM_ID, planId: PLAN_ID }),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 楽観更新で approved + status=completed (後続なし) になった瞬間を捕捉する。
    const optimistic = snapshots.find((s) => s[0]?.status === 'completed')?.[0];
    expect(optimistic).toBeDefined();
    expect(optimistic?.ballState).toBe('approved');
    expect(optimistic?.ballHolder?.id).toBe('mPm');
    expect(toastSuccess).toHaveBeenCalledWith('承認しました');
  });

  it('エラー時にロールバックして失敗トーストを出す', async () => {
    seedList(makeInProgressPlan());
    const snapshots = recordListSnapshots();
    server.use(
      http.post(approveUrl, () =>
        HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: '承認できません' } },
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHook(
      () => useApprovePlan({ projectId: PROJECT_ID, itemId: ITEM_ID, planId: PLAN_ID }),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // 一度は status=completed に楽観更新され、その後 active/in_progress へロールバックされる。
    expect(snapshots.some((s) => s[0]?.status === 'completed')).toBe(true);
    const rolledBack = snapshots[snapshots.length - 1]![0];
    expect(rolledBack?.status).toBe('active');
    expect(rolledBack?.ballState).toBe('in_progress');
    expect(toastError).toHaveBeenCalledWith('承認できません');
  });
});
