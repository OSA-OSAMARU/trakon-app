import { beforeEach, describe, expect, it } from 'vitest';

import type { PlanState } from '@trakon/shared';

import { api } from '../../test/request.js';
import {
  createItem,
  createMember,
  createPlan,
  setupProjectWithDirector,
} from '../../test/factories.js';

// =============================================================================
// public share ルートの統合テスト (実 DB + 未認証フロー) — #131
//   クライアント(非会員)の確認依頼 / 承認 / 差し戻しを検証する。
//   進行責任者の TOSS は共有リンクからは提供しない。
//   share トークンは認証付き作成ルートが返す生トークン (rawToken) を利用する。
// =============================================================================

type Ref = { id: string } | null;
type SharePlanDTO = {
  id: string;
  status: 'active' | 'completed' | 'canceled';
  ballState: PlanState;
  ballHolder: Ref;
};

type ShareViewBody = {
  data: {
    share: { id: string; scopeType: string; scopeTargetId: string | null };
    project: { id: string; name: string };
    items: Array<{ id: string; name: string }>;
    plans: SharePlanDTO[];
  };
};

describe('share routes (integration, #131)', () => {
  let ctx: Awaited<ReturnType<typeof setupProjectWithDirector>>;
  let itemId: string;
  let execId: string;
  let approverId: string;
  let pmId: string;

  beforeEach(async () => {
    ctx = await setupProjectWithDirector();
    const item = await createItem({ projectId: ctx.project.id });
    itemId = item.id;
    pmId = ctx.member.id;
    execId = (await createMember({ projectId: ctx.project.id, memberType: 'client' })).id;
    approverId = (await createMember({ projectId: ctx.project.id, memberType: 'client' })).id;
  });

  async function issueProjectShareToken(): Promise<string> {
    const res = await api<{ data: { rawToken: string } }>(
      `/api/v1/projects/${ctx.project.id}/share-links`,
      {
        method: 'POST',
        token: ctx.token,
        body: { scopeType: 'project', expiresInHours: 168 },
      },
    );
    expect(res.status).toBe(201);
    return res.body.data.rawToken;
  }

  const shareAct = (token: string, planId: string, action: string) =>
    api<{ data: { plan: SharePlanDTO } }>(`/api/v1/share/${token}/plans/${planId}/${action}`, {
      method: 'POST',
      body: {},
    });

  describe('正常系', () => {
    it('GET /share/:token は project scope の閲覧情報を返す', async () => {
      await createPlan({
        itemId,
        executorMemberId: execId,
        scheduledDate: new Date('2026-06-01'),
      });
      const token = await issueProjectShareToken();

      const res = await api<ShareViewBody>(`/api/v1/share/${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.share.scopeType).toBe('project');
      expect(res.body.data.plans).toHaveLength(1);
      expect(res.body.data.plans[0]!.ballState).toBe('in_progress');
    });

    it('承認者あり: 確認依頼→承認 で承認済みへ (クライアント操作)', async () => {
      const successor = await createPlan({
        itemId,
        executorMemberId: execId,
        progressManagerMemberId: pmId,
      });
      const plan = await createPlan({
        itemId,
        executorMemberId: execId,
        approverMemberId: approverId,
        progressManagerMemberId: pmId,
        successorPlanId: successor.id,
        status: 'active',
      });
      const token = await issueProjectShareToken();

      const reviewed = await shareAct(token, plan.id, 'request-review');
      expect(reviewed.status).toBe(200);
      expect(reviewed.body.data.plan.ballState).toBe('review_pending');

      const approved = await shareAct(token, plan.id, 'approve');
      expect(approved.status).toBe(200);
      expect(approved.body.data.plan.ballState).toBe('approved');
      expect(approved.body.data.plan.ballHolder?.id).toBe(pmId);
      // 後続があるので承認だけでは完了しない (TOSS は会員=進行責任者が行う)
      expect(approved.body.data.plan.status).toBe('active');
    });

    it('承認者なし短絡: approve で承認済みへ。後続なしは完了', async () => {
      const plan = await createPlan({
        itemId,
        executorMemberId: execId,
        progressManagerMemberId: pmId,
        status: 'active',
      });
      const token = await issueProjectShareToken();

      const res = await shareAct(token, plan.id, 'approve');
      expect(res.status).toBe(200);
      expect(res.body.data.plan.ballState).toBe('approved');
      expect(res.body.data.plan.status).toBe('completed'); // 後続なし = 承認で完了
    });

    it('確認待ち → 差し戻し で実施中へ戻る', async () => {
      const plan = await createPlan({
        itemId,
        executorMemberId: execId,
        approverMemberId: approverId,
        progressManagerMemberId: pmId,
        status: 'active',
      });
      const token = await issueProjectShareToken();
      await shareAct(token, plan.id, 'request-review');

      const res = await shareAct(token, plan.id, 'send-back');
      expect(res.status).toBe(200);
      expect(res.body.data.plan.ballState).toBe('sent_back');
    });
  });

  describe('異常系', () => {
    it('未存在トークンは 404 SHARE_NOT_FOUND_OR_EXPIRED', async () => {
      const res = await api<{ error: { code: string } }>('/api/v1/share/totally-invalid-token');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SHARE_NOT_FOUND_OR_EXPIRED');
    });

    it('revoke 済みリンクの閲覧は 404 に集約される', async () => {
      const created = await api<{ data: { shareLink: { id: string }; rawToken: string } }>(
        `/api/v1/projects/${ctx.project.id}/share-links`,
        {
          method: 'POST',
          token: ctx.token,
          body: { scopeType: 'project', expiresInHours: 168 },
        },
      );
      const token = created.body.data.rawToken;
      const shareLinkId = created.body.data.shareLink.id;
      const del = await api(`/api/v1/projects/${ctx.project.id}/share-links/${shareLinkId}`, {
        method: 'DELETE',
        token: ctx.token,
      });
      expect(del.status).toBe(204);

      const res = await api<{ error: { code: string } }>(`/api/v1/share/${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SHARE_NOT_FOUND_OR_EXPIRED');
    });

    it('scope 外 (別プロジェクト) の plan を承認すると 404', async () => {
      const token = await issueProjectShareToken();
      const other = await setupProjectWithDirector();
      const otherItem = await createItem({ projectId: other.project.id });
      const otherPlan = await createPlan({ itemId: otherItem.id, status: 'active' });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/share/${token}/plans/${otherPlan.id}/approve`,
        { method: 'POST', body: {} },
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SHARE_NOT_FOUND_OR_EXPIRED');
    });

    it('active でない plan の承認は 422 PLAN_NOT_ACTIVE', async () => {
      const plan = await createPlan({ itemId, status: 'completed' });
      const token = await issueProjectShareToken();

      const res = await api<{ error: { code: string } }>(
        `/api/v1/share/${token}/plans/${plan.id}/approve`,
        { method: 'POST', body: {} },
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PLAN_NOT_ACTIVE');
    });

    it('TOSS エンドポイントは共有リンクに存在しない (404)', async () => {
      const plan = await createPlan({
        itemId,
        executorMemberId: execId,
        progressManagerMemberId: pmId,
        status: 'active',
      });
      const token = await issueProjectShareToken();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/share/${token}/plans/${plan.id}/toss`,
        { method: 'POST', body: {} },
      );
      // ルート未定義のため 404 (Hono の not found)
      expect(res.status).toBe(404);
    });
  });
});
