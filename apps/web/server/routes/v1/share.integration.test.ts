import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../../test/request.js';
import {
  createItem,
  createMember,
  createPlan,
  setupProjectWithDirector,
} from '../../test/factories.js';

// =============================================================================
// public share ルートの統合テスト (実 DB + 未認証フロー)
// 正常系: 閲覧 / TOSS / 完了、異常系: 無効トークン / scope 外 / 非 active
// share トークンは認証付き作成ルート (POST /projects/:id/share-links) が返す
// 生トークン (rawToken) を利用する。ハッシュ保存のため後から復元できない。
// =============================================================================

type SharePlanDTO = {
  id: string;
  status: 'active' | 'completed' | 'canceled';
  ballState: 'ready' | 'tossed' | 'completed';
};

type ShareViewBody = {
  data: {
    share: { id: string; scopeType: string; scopeTargetId: string | null };
    project: { id: string; name: string };
    items: Array<{ id: string; name: string }>;
    plans: SharePlanDTO[];
  };
};

describe('share routes (integration)', () => {
  let ctx: Awaited<ReturnType<typeof setupProjectWithDirector>>;
  let itemId: string;
  let fromId: string;
  let toId: string;

  beforeEach(async () => {
    ctx = await setupProjectWithDirector();
    const item = await createItem({ projectId: ctx.project.id });
    itemId = item.id;
    fromId = ctx.member.id;
    const other = await createMember({
      projectId: ctx.project.id,
      memberType: 'production',
    });
    toId = other.id;
  });

  // 認証付きルートで project scope の share-link を発行し、生トークンを得る。
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

  describe('正常系', () => {
    it('GET /share/:token は project scope の閲覧情報を返す', async () => {
      await createPlan({
        itemId,
        fromMemberId: fromId,
        toMemberId: toId,
        scheduledDate: new Date('2026-06-01'),
      });
      const token = await issueProjectShareToken();

      const res = await api<ShareViewBody>(`/api/v1/share/${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.share.scopeType).toBe('project');
      expect(res.body.data.project.id).toBe(ctx.project.id);
      expect(res.body.data.items.map((i) => i.id)).toContain(itemId);
      expect(res.body.data.plans).toHaveLength(1);
    });

    it('POST /share/:token/plans/:planId/toss は ballState=tossed を返す', async () => {
      const plan = await createPlan({
        itemId,
        fromMemberId: fromId,
        toMemberId: toId,
        status: 'active',
      });
      const token = await issueProjectShareToken();

      const res = await api<{ data: { plan: SharePlanDTO } }>(
        `/api/v1/share/${token}/plans/${plan.id}/toss`,
        { method: 'POST', body: {} },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.plan.id).toBe(plan.id);
      expect(res.body.data.plan.ballState).toBe('tossed');
    });

    it('POST /share/:token/plans/:planId/complete は status=completed を返す', async () => {
      const plan = await createPlan({
        itemId,
        fromMemberId: fromId,
        toMemberId: toId,
        status: 'active',
      });
      const token = await issueProjectShareToken();

      const res = await api<{ data: { plan: SharePlanDTO; autoTossed: SharePlanDTO | null } }>(
        `/api/v1/share/${token}/plans/${plan.id}/complete`,
        { method: 'POST', body: {} },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.plan.status).toBe('completed');
      expect(res.body.data.autoTossed).toBeNull();
    });
  });

  describe('異常系', () => {
    it('未存在トークンは 404 SHARE_NOT_FOUND_OR_EXPIRED', async () => {
      const res = await api<{ error: { code: string } }>(
        '/api/v1/share/totally-invalid-token',
      );
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
      // 同じディレクターが revoke
      const del = await api(
        `/api/v1/projects/${ctx.project.id}/share-links/${shareLinkId}`,
        { method: 'DELETE', token: ctx.token },
      );
      expect(del.status).toBe(204);

      const res = await api<{ error: { code: string } }>(`/api/v1/share/${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SHARE_NOT_FOUND_OR_EXPIRED');
    });

    it('scope 外 (別プロジェクト) の plan を TOSS すると 404', async () => {
      const token = await issueProjectShareToken();
      // 別プロジェクトの plan
      const other = await setupProjectWithDirector();
      const otherItem = await createItem({ projectId: other.project.id });
      const otherPlan = await createPlan({ itemId: otherItem.id, status: 'active' });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/share/${token}/plans/${otherPlan.id}/toss`,
        { method: 'POST', body: {} },
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SHARE_NOT_FOUND_OR_EXPIRED');
    });

    it('active でない plan の TOSS は 422 PLAN_NOT_ACTIVE', async () => {
      const plan = await createPlan({ itemId, status: 'completed' });
      const token = await issueProjectShareToken();

      const res = await api<{ error: { code: string } }>(
        `/api/v1/share/${token}/plans/${plan.id}/toss`,
        { method: 'POST', body: {} },
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PLAN_NOT_ACTIVE');
    });

    it('既に TOSS 済みの plan を再 TOSS すると 409 ALREADY_TOSSED', async () => {
      const plan = await createPlan({
        itemId,
        fromMemberId: fromId,
        toMemberId: toId,
        status: 'active',
      });
      const token = await issueProjectShareToken();
      const first = await api(`/api/v1/share/${token}/plans/${plan.id}/toss`, {
        method: 'POST',
        body: {},
      });
      expect(first.status).toBe(200);

      const res = await api<{ error: { code: string } }>(
        `/api/v1/share/${token}/plans/${plan.id}/toss`,
        { method: 'POST', body: {} },
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_TOSSED');
    });
  });
});
