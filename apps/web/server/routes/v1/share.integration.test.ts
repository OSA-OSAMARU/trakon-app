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
// public share ルートの統合テスト (実 DB + 未認証フロー) — #257
//   共有リンクは **閲覧専用**。#131 で追加した確認依頼 / 承認 / 差し戻しは
//   削除済みで、データを変える POST は 1 本も存在しない (全プラン共通)。
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

describe('share routes (integration, #257)', () => {
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

  /** 共有リンク経由でデータを変えようとする POST。閲覧専用なので全て 404 になる */
  const shareAct = (token: string, planId: string, action: string) =>
    api<{ error?: { code: string } }>(`/api/v1/share/${token}/plans/${planId}/${action}`, {
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

    it('非会員に個人情報を渡さない: メール / 職種 / アイコンを含まない (#159)', async () => {
      await createPlan({
        itemId,
        executorMemberId: execId,
        scheduledDate: new Date('2026-06-01'),
      });
      const token = await issueProjectShareToken();

      const res = await api<ShareViewBody>(`/api/v1/share/${token}`);
      expect(res.status).toBe(200);

      // 予定 DTO (toPlanDTO) は共有ページでもそのまま使われる。
      // ここに項目を足すと非会員へ筒抜けになるので、レスポンス全体を走査して見張る。
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/"email"/);
      expect(raw).not.toMatch(/"jobTitle"/);
      expect(raw).not.toMatch(/"avatarUrl"/);
      expect(raw).not.toMatch(/"avatarPath"/);
      // 実際のメールアドレス文字列も出ていないこと
      expect(raw).not.toContain('@example.test');
    });

    it('予定の状態は閲覧できる (承認待ちなどを確認できる)', async () => {
      const plan = await createPlan({
        itemId,
        executorMemberId: execId,
        approverMemberId: approverId,
        progressManagerMemberId: pmId,
        status: 'active',
      });
      const token = await issueProjectShareToken();

      const res = await api<ShareViewBody>(`/api/v1/share/${token}`);

      expect(res.status).toBe(200);
      const found = res.body.data.plans.find((p) => p.id === plan.id);
      expect(found?.ballState).toBe('in_progress');
      expect(found?.ballHolder?.id).toBe(execId);
    });
  });

  describe('閲覧専用 (#257)', () => {
    // #131 では共有リンクから確認依頼 / 承認 / 差し戻しができた。全プランで
    // 「共有リンクで訪れた人は閲覧のみ」という方針になったためルートを削除した。
    it.each(['request-review', 'approve', 'send-back', 'toss', 'complete'])(
      'データを変える POST は存在しない: %s',
      async (action) => {
        const plan = await createPlan({
          itemId,
          executorMemberId: execId,
          approverMemberId: approverId,
          progressManagerMemberId: pmId,
          status: 'active',
        });
        const token = await issueProjectShareToken();

        const res = await shareAct(token, plan.id, action);

        // ルート未定義のため 404 (Hono の not found)
        expect(res.status).toBe(404);
      },
    );

    it('承認を試みても予定の状態は変わらない', async () => {
      const plan = await createPlan({
        itemId,
        executorMemberId: execId,
        approverMemberId: approverId,
        progressManagerMemberId: pmId,
        status: 'active',
      });
      const token = await issueProjectShareToken();

      await shareAct(token, plan.id, 'approve');

      const res = await api<ShareViewBody>(`/api/v1/share/${token}`);
      const found = res.body.data.plans.find((p) => p.id === plan.id);
      expect(found?.status).toBe('active');
      expect(found?.ballState).toBe('in_progress');
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
  });
});
