import { beforeEach, describe, expect, it } from 'vitest';

import { deriveLineBallHolders, type PlanState } from '@trakon/shared';

import { api } from '../../test/request.js';
import { createItem, createMember, setupProjectWithDirector } from '../../test/factories.js';

// =============================================================================
// plans / ball アクションの統合テスト (実 DB + ミドルウェアチェーン) — #131 新状態機械
//   実施中 → 確認依頼 → 確認待ち → 承認 → 承認済み → TOSS → TOSS済み / 差し戻し
//   director トークンで操作 (isDirector が holder 認可をバイパスするため遷移検証に集中)
// =============================================================================

type Ref = { id: string } | null;
type PlanDTO = {
  id: string;
  ballState: PlanState;
  status: 'active' | 'completed' | 'canceled';
  successorPlanId: string | null;
  executor: Ref;
  approver: Ref;
  progressManager: Ref;
  fromMember: Ref;
  toMember: Ref;
  ballHolder: Ref;
  latestEvent: { eventType: string; source: string } | null;
};

describe('plans routes (integration, #131)', () => {
  let ctx: Awaited<ReturnType<typeof setupProjectWithDirector>>;
  let itemId: string;
  let execId: string;
  let approverId: string;
  let pmId: string;
  let base: string;

  beforeEach(async () => {
    ctx = await setupProjectWithDirector();
    const item = await createItem({ projectId: ctx.project.id });
    itemId = item.id;
    pmId = ctx.member.id; // director = production メンバーを進行責任者に使う
    execId = (await createMember({ projectId: ctx.project.id, memberType: 'production' })).id;
    approverId = (await createMember({ projectId: ctx.project.id, memberType: 'client' })).id;
    base = `/api/v1/projects/${ctx.project.id}/items/${itemId}/plans`;
  });

  async function createPlanViaApi(body: Record<string, unknown>) {
    return api<{ data: PlanDTO }>(base, { method: 'POST', token: ctx.token, body });
  }
  const act = (planId: string, action: string) =>
    api<{ data: { plan: PlanDTO } }>(`${base}/${planId}/${action}`, {
      method: 'POST',
      token: ctx.token,
      body: {},
    });
  const getPlan = (planId: string) =>
    api<{ data: { plan: PlanDTO } }>(`${base}/${planId}`, { token: ctx.token });

  describe('正常系: 状態遷移', () => {
    it('作成直後は ballState=in_progress、保持者=実施者', async () => {
      const res = await createPlanViaApi({
        title: 'デザイン作成',
        category: 'design',
        scheduledDate: '2026-07-01',
        executorMemberId: execId,
        approverMemberId: approverId,
        progressManagerMemberId: pmId,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.ballState).toBe('in_progress');
      expect(res.body.data.ballHolder?.id).toBe(execId);
    });

    it('承認者あり: 確認依頼で確認待ち・保持者=承認者、承認で承認済み・保持者=進行責任者', async () => {
      const successor = await createPlanViaApi({
        title: 'デザイン確認',
        category: 'review',
        scheduledDate: '2026-07-10',
        executorMemberId: approverId,
        progressManagerMemberId: pmId,
      });
      const created = await createPlanViaApi({
        title: 'デザイン作成',
        category: 'design',
        scheduledDate: '2026-07-01',
        executorMemberId: execId,
        approverMemberId: approverId,
        progressManagerMemberId: pmId,
        successorPlanId: successor.body.data.id,
      });
      const planId = created.body.data.id;

      const reviewed = await act(planId, 'request-review');
      expect(reviewed.body.data.plan.ballState).toBe('review_pending');
      expect(reviewed.body.data.plan.ballHolder?.id).toBe(approverId);
      expect(reviewed.body.data.plan.latestEvent?.eventType).toBe('review_requested');

      const approved = await act(planId, 'approve');
      expect(approved.body.data.plan.ballState).toBe('approved');
      expect(approved.body.data.plan.ballHolder?.id).toBe(pmId);
      // 後続があるので承認だけでは完了しない
      expect(approved.body.data.plan.status).toBe('active');
    });

    it('承認しても後続は自動開始しない。TOSS で後続の実施者へ移る (FROM=進行責任者/TO=後続実施者)', async () => {
      const succExecId = (await createMember({ projectId: ctx.project.id, memberType: 'production' })).id;
      const successor = await createPlanViaApi({
        title: '実装',
        category: 'coding',
        scheduledDate: '2026-07-20',
        executorMemberId: succExecId,
        progressManagerMemberId: pmId,
      });
      const created = await createPlanViaApi({
        title: 'デザイン確認',
        category: 'review',
        scheduledDate: '2026-07-10',
        executorMemberId: approverId,
        approverMemberId: approverId,
        progressManagerMemberId: pmId,
        successorPlanId: successor.body.data.id,
      });
      const planId = created.body.data.id;
      await act(planId, 'request-review');
      await act(planId, 'approve');

      // 承認後も後続は実施中のまま (自動開始しない)
      const succBefore = await getPlan(successor.body.data.id);
      expect(succBefore.body.data.plan.ballState).toBe('in_progress');

      const tossed = await act(planId, 'toss');
      expect(tossed.body.data.plan.ballState).toBe('tossed');
      expect(tossed.body.data.plan.status).toBe('completed');
      expect(tossed.body.data.plan.latestEvent?.eventType).toBe('tossed');
      // FROM=進行責任者、TO=後続の実施者 (§14)
      expect(tossed.body.data.plan.fromMember?.id).toBe(pmId);
      expect(tossed.body.data.plan.toMember?.id).toBe(succExecId);
    });

    it('承認者なし短絡: 実施中から直接 approve で承認済みへ', async () => {
      const successor = await createPlanViaApi({
        title: '次工程',
        category: 'coding',
        scheduledDate: '2026-07-20',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
      });
      const created = await createPlanViaApi({
        title: '作業',
        category: 'design',
        scheduledDate: '2026-07-01',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
        successorPlanId: successor.body.data.id,
      });
      const approved = await act(created.body.data.id, 'approve');
      expect(approved.body.data.plan.ballState).toBe('approved');
      expect(approved.body.data.plan.ballHolder?.id).toBe(pmId);
    });

    it('承認=完了扱い: 後続の無い予定は承認で status=completed', async () => {
      const created = await createPlanViaApi({
        title: '最終確認',
        category: 'review',
        scheduledDate: '2026-07-01',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
      });
      const approved = await act(created.body.data.id, 'approve');
      expect(approved.body.data.plan.status).toBe('completed');
    });

    it('前工程へ差し戻し (§13): 後続の実施中から先行(デザイン作成)を再開する', async () => {
      const clientId = (await createMember({ projectId: ctx.project.id, memberType: 'client' })).id;
      // 後続: デザイン確認 (実施者=クライアント)
      const review = await createPlanViaApi({
        title: 'デザイン確認',
        category: 'review',
        scheduledDate: '2026-07-20',
        executorMemberId: clientId,
        progressManagerMemberId: pmId,
      });
      // 先行: デザイン作成 (実施者=execId)、後続=デザイン確認
      const design = await createPlanViaApi({
        title: 'デザイン作成',
        category: 'design',
        scheduledDate: '2026-07-10',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
        successorPlanId: review.body.data.id,
      });
      // デザイン作成を承認→TOSS (先行完了、ボールはデザイン確認の実施者=クライアントへ)
      await act(design.body.data.id, 'approve');
      await act(design.body.data.id, 'toss');
      const reviewAfterToss = await getPlan(review.body.data.id);
      expect(reviewAfterToss.body.data.plan.ballState).toBe('in_progress');

      // デザイン確認(実施中)から前工程へ差し戻し
      const res = await api<{ data: { plan: PlanDTO; predecessor: PlanDTO } }>(
        `${base}/${review.body.data.id}/send-back-to-predecessor`,
        { method: 'POST', token: ctx.token, body: { note: '色を修正してください' } },
      );
      expect(res.status).toBe(200);
      // 先行(デザイン作成)が再開: 実施者にボール、active、FROM/TO 履歴は解除
      expect(res.body.data.predecessor.ballState).toBe('sent_back');
      expect(res.body.data.predecessor.ballHolder?.id).toBe(execId);
      expect(res.body.data.predecessor.status).toBe('active');
      expect(res.body.data.predecessor.fromMember).toBeNull();
      // 後続(デザイン確認)は実施中のまま (新カードは作られない)
      expect(res.body.data.plan.ballState).toBe('in_progress');

      // ライン保持者は先行の実施者へ戻る
      const design2 = await getPlan(design.body.data.id);
      expect(design2.body.data.plan.status).toBe('active');
    });

    it('同一予定内の差し戻し: 確認待ち→差し戻し→実施中 (新カードを作らない)', async () => {
      const created = await createPlanViaApi({
        title: 'デザイン作成',
        category: 'design',
        scheduledDate: '2026-07-01',
        executorMemberId: execId,
        approverMemberId: approverId,
        progressManagerMemberId: pmId,
      });
      const planId = created.body.data.id;
      await act(planId, 'request-review');
      const sentBack = await api<{ data: { plan: PlanDTO } }>(`${base}/${planId}/send-back`, {
        method: 'POST',
        token: ctx.token,
        body: { note: '色を修正してください' },
      });
      expect(sentBack.body.data.plan.ballState).toBe('sent_back');
      expect(sentBack.body.data.plan.ballHolder?.id).toBe(execId);

      // 再度 確認依頼 できる (同じカードで修正フローが続く)
      const reReviewed = await act(planId, 'request-review');
      expect(reReviewed.body.data.plan.ballState).toBe('review_pending');
    });

    it('TOSS の取り消し: TOSS済み→承認済みへ戻り FROM/TO 履歴が消える', async () => {
      const successor = await createPlanViaApi({
        title: '実装',
        category: 'coding',
        scheduledDate: '2026-07-20',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
      });
      const created = await createPlanViaApi({
        title: '確認',
        category: 'review',
        scheduledDate: '2026-07-10',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
        successorPlanId: successor.body.data.id,
      });
      const planId = created.body.data.id;
      await act(planId, 'approve');
      await act(planId, 'toss');
      const undone = await act(planId, 'toss-undo');
      expect(undone.body.data.plan.ballState).toBe('approved');
      expect(undone.body.data.plan.status).toBe('active');
      expect(undone.body.data.plan.fromMember).toBeNull();
      expect(undone.body.data.plan.toMember).toBeNull();
    });
  });

  // ライン単位の代表ボール保持者 (deriveLineBallHolders) を実データで検証する。
  describe('ボール保持者 (ライン単位)', () => {
    async function holdersNow(): Promise<string[]> {
      const list = await api<{ data: PlanDTO[] }>(base, { token: ctx.token });
      return deriveLineBallHolders(
        list.body.data.map((p) => ({
          id: p.id,
          successorPlanId: p.successorPlanId,
          status: p.status,
          ballState: p.ballState,
          executorMemberId: p.executor?.id ?? null,
          approverMemberId: p.approver?.id ?? null,
          progressManagerMemberId: p.progressManager?.id ?? null,
          toMemberId: p.toMember?.id ?? null,
        })),
      );
    }

    it('先行を承認→TOSS→完了すると保持者は後続の実施者へ移る', async () => {
      const succExecId = (await createMember({ projectId: ctx.project.id, memberType: 'production' })).id;
      const design = await createPlanViaApi({
        title: 'デザイン作成',
        category: 'design',
        scheduledDate: '2026-07-19',
        executorMemberId: succExecId,
        progressManagerMemberId: pmId,
      });
      const wire = await createPlanViaApi({
        title: 'ワイヤー作成',
        category: 'wireframe',
        scheduledDate: '2026-07-11',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
        successorPlanId: design.body.data.id,
      });
      // ワイヤーを承認 → TOSS (承認者なし短絡)
      await act(wire.body.data.id, 'approve');
      await act(wire.body.data.id, 'toss');
      // ワイヤーは完了、ボールは後続=デザインの実施者へ
      expect(await holdersNow()).toEqual([succExecId]);
    });
  });

  describe('異常系', () => {
    it('一覧取得は未認証だと 401', async () => {
      const res = await api<{ error: { code: string } }>(base);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_MISSING');
    });

    it('承認前に TOSS すると 409 NOT_APPROVED', async () => {
      const successor = await createPlanViaApi({
        title: '次',
        category: 'coding',
        scheduledDate: '2026-07-20',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
      });
      const created = await createPlanViaApi({
        title: '作業',
        category: 'design',
        scheduledDate: '2026-07-01',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
        successorPlanId: successor.body.data.id,
      });
      const res = await api<{ error: { code: string } }>(`${base}/${created.body.data.id}/toss`, {
        method: 'POST',
        token: ctx.token,
        body: {},
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOT_APPROVED');
    });

    it('承認者未設定で確認依頼すると 422 NO_APPROVER', async () => {
      const created = await createPlanViaApi({
        title: '作業',
        category: 'design',
        scheduledDate: '2026-07-01',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
      });
      const res = await api<{ error: { code: string } }>(
        `${base}/${created.body.data.id}/request-review`,
        { method: 'POST', token: ctx.token, body: {} },
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('NO_APPROVER');
    });

    it('後続の無い承認済み予定を TOSS すると 422 NO_SUCCESSOR', async () => {
      const created = await createPlanViaApi({
        title: '作業',
        category: 'design',
        scheduledDate: '2026-07-01',
        executorMemberId: execId,
        progressManagerMemberId: pmId,
      });
      // 後続なし → approve で completed になる。completed は TOSS 不可 (PLAN_NOT_ACTIVE)
      await act(created.body.data.id, 'approve');
      const res = await api<{ error: { code: string } }>(`${base}/${created.body.data.id}/toss`, {
        method: 'POST',
        token: ctx.token,
        body: {},
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PLAN_NOT_ACTIVE');
    });
  });
});
