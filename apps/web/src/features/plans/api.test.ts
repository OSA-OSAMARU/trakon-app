import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/handlers';

// supabase はモックして getSession を制御する (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { supabase } from '@/lib/supabase';
import { plansApi } from './api';
import type { Plan, PlanDetail, BallActionResult } from './api';

const getSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } });
});

// テスト用の最小 Plan スタブ。
const stubPlan: Plan = {
  id: 'plan-1',
  itemId: 'item-1',
  planType: 'toss',
  title: 'タイトル',
  category: 'design',
  scheduledDate: '2026-01-01',
  dueDate: null,
  fromMember: null,
  toMember: null,
  successorPlanId: null,
  status: 'active',
  memo: null,
  ballHolder: null,
  ballState: 'ready',
  latestEvent: null,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const P = 'proj-1';
const IT = 'item-1';
const PL = 'plan-1';

describe('plansApi', () => {
  it('list: query なしでパスを組み立て data を返す', async () => {
    let url: string | null = null;
    server.use(
      http.get('*/api/v1/projects/proj-1/items/item-1/plans', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: [stubPlan] });
      }),
    );
    const res = await plansApi.list(P, IT);
    expect(res).toEqual([stubPlan]);
    expect(url).not.toContain('?');
  });

  it('list: from/to を query string に載せる', async () => {
    let url = '';
    server.use(
      http.get('*/api/v1/projects/proj-1/items/item-1/plans', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: [] });
      }),
    );
    await plansApi.list(P, IT, { from: '2026-01-01', to: '2026-01-31' });
    const sp = new URL(url).searchParams;
    expect(sp.get('from')).toBe('2026-01-01');
    expect(sp.get('to')).toBe('2026-01-31');
  });

  it('listByProject: from のみでも query を載せる', async () => {
    let url = '';
    server.use(
      http.get('*/api/v1/projects/proj-1/plans', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: [stubPlan] });
      }),
    );
    const res = await plansApi.listByProject(P, { from: '2026-02-01' });
    expect(res).toEqual([stubPlan]);
    const sp = new URL(url).searchParams;
    expect(sp.get('from')).toBe('2026-02-01');
    expect(sp.has('to')).toBe(false);
  });

  it('listByProject: query なしでもパスを組み立てる', async () => {
    let url = '';
    server.use(
      http.get('*/api/v1/projects/proj-1/plans', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: [] });
      }),
    );
    await plansApi.listByProject(P);
    expect(url).not.toContain('?');
  });

  it('get: 詳細を取得する', async () => {
    const detail: PlanDetail = { plan: stubPlan, events: [] };
    server.use(
      http.get('*/api/v1/projects/proj-1/items/item-1/plans/plan-1', () =>
        HttpResponse.json({ data: detail }),
      ),
    );
    const res = await plansApi.get(P, IT, PL);
    expect(res).toEqual(detail);
  });

  it('create: POST で body を送り Plan を返す', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.post('*/api/v1/projects/proj-1/items/item-1/plans', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ data: stubPlan });
      }),
    );
    const input = { title: 'T', category: 'design' as const, scheduledDate: '2026-01-01' };
    const res = await plansApi.create(P, IT, input);
    expect(res).toEqual(stubPlan);
    expect(method).toBe('POST');
    expect(body).toEqual(input);
  });

  it('copy: POST で空 body を送る', async () => {
    let body: unknown = 'unset';
    server.use(
      http.post('*/api/v1/projects/proj-1/items/item-1/plans/plan-1/copy', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: stubPlan });
      }),
    );
    const res = await plansApi.copy(P, IT, PL);
    expect(res).toEqual(stubPlan);
    expect(body).toEqual({});
  });

  it('update: PATCH で body を送る', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.patch('*/api/v1/projects/proj-1/items/item-1/plans/plan-1', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ data: stubPlan });
      }),
    );
    await plansApi.update(P, IT, PL, { title: '更新' });
    expect(method).toBe('PATCH');
    expect(body).toEqual({ title: '更新' });
  });

  it('remove: DELETE で 204 を扱う', async () => {
    let method = '';
    server.use(
      http.delete('*/api/v1/projects/proj-1/items/item-1/plans/plan-1', ({ request }) => {
        method = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const res = await plansApi.remove(P, IT, PL);
    expect(res).toBeUndefined();
    expect(method).toBe('DELETE');
  });

  it('setSuccessor: PATCH で successorPlanId を送る', async () => {
    let body: unknown = null;
    server.use(
      http.patch(
        '*/api/v1/projects/proj-1/items/item-1/plans/plan-1/successor',
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: stubPlan });
        },
      ),
    );
    await plansApi.setSuccessor(P, IT, PL, 'plan-2');
    expect(body).toEqual({ successorPlanId: 'plan-2' });
  });

  it('toss: body 指定時はそれを送る', async () => {
    let body: unknown = null;
    const result: BallActionResult = { plan: stubPlan, autoTossed: null };
    server.use(
      http.post('*/api/v1/projects/proj-1/items/item-1/plans/plan-1/toss', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: result });
      }),
    );
    const res = await plansApi.toss(P, IT, PL, { toMemberId: 'm-1' });
    expect(res).toEqual(result);
    expect(body).toEqual({ toMemberId: 'm-1' });
  });

  it('toss: body 未指定時は空 body を送る', async () => {
    let body: unknown = 'unset';
    const result: BallActionResult = { plan: stubPlan, autoTossed: null };
    server.use(
      http.post('*/api/v1/projects/proj-1/items/item-1/plans/plan-1/toss', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: result });
      }),
    );
    await plansApi.toss(P, IT, PL);
    expect(body).toEqual({});
  });

  it('complete: POST で BallActionResult を返す', async () => {
    const result: BallActionResult = { plan: stubPlan, autoTossed: null };
    server.use(
      http.post('*/api/v1/projects/proj-1/items/item-1/plans/plan-1/complete', () =>
        HttpResponse.json({ data: result }),
      ),
    );
    const res = await plansApi.complete(P, IT, PL);
    expect(res).toEqual(result);
  });

  it('undoToss: POST で { plan } を返す', async () => {
    server.use(
      http.post('*/api/v1/projects/proj-1/items/item-1/plans/plan-1/toss-undo', () =>
        HttpResponse.json({ data: { plan: stubPlan } }),
      ),
    );
    const res = await plansApi.undoToss(P, IT, PL);
    expect(res).toEqual({ plan: stubPlan });
  });

  it('undoComplete: POST で { plan } を返す', async () => {
    server.use(
      http.post('*/api/v1/projects/proj-1/items/item-1/plans/plan-1/complete-undo', () =>
        HttpResponse.json({ data: { plan: stubPlan } }),
      ),
    );
    const res = await plansApi.undoComplete(P, IT, PL);
    expect(res).toEqual({ plan: stubPlan });
  });

  it('エラー応答時は reject する', async () => {
    server.use(
      http.get('*/api/v1/projects/proj-1/items/item-1/plans/plan-1', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: '見つかりません' } },
          { status: 404 },
        ),
      ),
    );
    await expect(plansApi.get(P, IT, PL)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});
