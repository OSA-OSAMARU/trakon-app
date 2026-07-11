import { beforeEach, describe, expect, it } from 'vitest';

import { deriveLineBallHolders } from '@trakon/shared';

import { api } from '../../test/request.js';
import {
  createItem,
  createMember,
  setupProjectWithDirector,
} from '../../test/factories.js';

// =============================================================================
// plans / ball アクションの統合テスト (実 DB + ミドルウェアチェーン)
// 正常系: 作成 / TOSS / 完了 / 自動連鎖、異常系: 401 / 422 / 409
// =============================================================================

type PlanDTO = {
  id: string;
  ballState: 'ready' | 'tossed' | 'completed';
  status: 'active' | 'completed' | 'canceled';
  latestEvent: { eventType: string; source: string } | null;
};

describe('plans routes (integration)', () => {
  let ctx: Awaited<ReturnType<typeof setupProjectWithDirector>>;
  let itemId: string;
  let fromId: string;
  let toId: string;
  let base: string;

  beforeEach(async () => {
    ctx = await setupProjectWithDirector();
    const item = await createItem({ projectId: ctx.project.id });
    itemId = item.id;
    fromId = ctx.member.id; // ディレクター = production メンバー
    const other = await createMember({
      projectId: ctx.project.id,
      memberType: 'production',
    });
    toId = other.id;
    base = `/api/v1/projects/${ctx.project.id}/items/${itemId}/plans`;
  });

  async function createPlanViaApi(body: Record<string, unknown>) {
    return api<{ data: PlanDTO }>(base, { method: 'POST', token: ctx.token, body });
  }

  describe('正常系', () => {
    it('予定を作成すると ballState=ready で返る', async () => {
      const res = await createPlanViaApi({
        title: 'Design',
        category: 'design',
        scheduledDate: '2026-06-01',
        fromMemberId: fromId,
        toMemberId: toId,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.ballState).toBe('ready');
    });

    it('PATCH で fromMemberId=null を送ると担当者を未設定に戻せる (#114)', async () => {
      const created = await createPlanViaApi({
        title: 'Design',
        category: 'design',
        scheduledDate: '2026-06-01',
        fromMemberId: fromId,
        toMemberId: toId,
      });
      const planId = created.body.data.id;

      const res = await api<{
        data: { fromMember: { id: string } | null; toMember: { id: string } | null };
      }>(`${base}/${planId}`, {
        method: 'PATCH',
        token: ctx.token,
        body: { fromMemberId: null },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.fromMember).toBeNull();
      // TO は未指定なので維持される
      expect(res.body.data.toMember?.id).toBe(toId);
    });

    it('TOSS すると ballState=tossed・最新イベントが tossed になる', async () => {
      const created = await createPlanViaApi({
        title: 'Design',
        category: 'design',
        scheduledDate: '2026-06-01',
        fromMemberId: fromId,
        toMemberId: toId,
      });
      const planId = created.body.data.id;

      const res = await api<{ data: { plan: PlanDTO; autoTossed: PlanDTO | null } }>(
        `${base}/${planId}/toss`,
        { method: 'POST', token: ctx.token, body: {} },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.plan.ballState).toBe('tossed');
      expect(res.body.data.plan.latestEvent?.eventType).toBe('tossed');
    });

    it('完了すると status=completed になる', async () => {
      const created = await createPlanViaApi({
        title: 'Design',
        category: 'design',
        scheduledDate: '2026-06-01',
        fromMemberId: fromId,
        toMemberId: toId,
      });
      const planId = created.body.data.id;
      await api(`${base}/${planId}/toss`, { method: 'POST', token: ctx.token, body: {} });

      const res = await api<{ data: { plan: PlanDTO } }>(`${base}/${planId}/complete`, {
        method: 'POST',
        token: ctx.token,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.plan.status).toBe('completed');
      expect(res.body.data.plan.ballState).toBe('completed');
    });

    it('後続を持つ予定を完了すると後続が auto_chain で TOSS される', async () => {
      const successor = await createPlanViaApi({
        title: 'Coding',
        category: 'coding',
        scheduledDate: '2026-06-10',
        fromMemberId: fromId,
        toMemberId: toId,
      });
      const head = await createPlanViaApi({
        title: 'Design',
        category: 'design',
        scheduledDate: '2026-06-01',
        fromMemberId: fromId,
        toMemberId: toId,
        successorPlanId: successor.body.data.id,
      });

      const res = await api<{ data: { plan: PlanDTO; autoTossed: PlanDTO | null } }>(
        `${base}/${head.body.data.id}/complete`,
        { method: 'POST', token: ctx.token },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.autoTossed?.id).toBe(successor.body.data.id);
      expect(res.body.data.autoTossed?.latestEvent?.source).toBe('auto_chain');
    });
  });

  // #117: ライン単位の代表ボール保持者 (deriveLineBallHolders) を実データで検証する。
  describe('#117 ボール保持者 (ライン単位)', () => {
    type FullPlan = {
      id: string;
      status: 'active' | 'completed' | 'canceled';
      ballState: 'ready' | 'tossed' | 'completed';
      successorPlanId: string | null;
      fromMember: { id: string } | null;
      toMember: { id: string } | null;
    };

    async function holdersNow(): Promise<string[]> {
      const list = await api<{ data: FullPlan[] }>(base, { token: ctx.token });
      return deriveLineBallHolders(
        list.body.data.map((p) => ({
          id: p.id,
          successorPlanId: p.successorPlanId,
          status: p.status,
          ballState: p.ballState,
          fromMemberId: p.fromMember?.id ?? null,
          toMemberId: p.toMember?.id ?? null,
        })),
      );
    }

    // ワイヤー(FROM=fromId TO=toId) → デザイン(FROM=dzFrom TO=dzTo) を後続で連結し、
    // ワイヤーを TOSS→完了 する (完了時にデザインが auto-toss される)。
    async function setupLinkedChain() {
      const dzFrom = await createMember({ projectId: ctx.project.id, memberType: 'production' });
      const dzTo = await createMember({ projectId: ctx.project.id, memberType: 'production' });
      const design = await createPlanViaApi({
        title: 'デザイン作成',
        category: 'design',
        scheduledDate: '2026-07-19',
        dueDate: '2026-07-26',
        fromMemberId: dzFrom.id,
        toMemberId: dzTo.id,
      });
      const wire = await createPlanViaApi({
        title: 'ワイヤー作成',
        category: 'wireframe',
        scheduledDate: '2026-07-11',
        dueDate: '2026-07-18',
        fromMemberId: fromId,
        toMemberId: toId,
        successorPlanId: design.body.data.id,
      });
      await api(`${base}/${wire.body.data.id}/toss`, { method: 'POST', token: ctx.token, body: {} });
      await api(`${base}/${wire.body.data.id}/complete`, { method: 'POST', token: ctx.token });
      return { wire: wire.body.data, design: design.body.data, dzFrom: dzFrom.id, dzTo: dzTo.id };
    }

    it('ケース3: ワイヤー完了・デザイン未TOSS → デザインの FROM', async () => {
      const { design, dzFrom } = await setupLinkedChain();
      // 完了時に auto-toss されたデザインを差し戻して「未TOSS」に戻す
      await api(`${base}/${design.id}/toss-undo`, { method: 'POST', token: ctx.token, body: {} });
      expect(await holdersNow()).toEqual([dzFrom]);
    });

    it('ケース4: ワイヤー完了・デザインTOSS済 → デザインの TO', async () => {
      const { dzTo } = await setupLinkedChain();
      // 完了時の auto-toss でデザインは tossed のまま
      expect(await holdersNow()).toEqual([dzTo]);
    });
  });

  describe('異常系', () => {
    it('一覧取得は未認証だと 401', async () => {
      const res = await api<{ error: { code: string } }>(base);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_MISSING');
    });

    it('FROM/TO 未設定の予定を TOSS すると 422 INCOMPLETE_PLAN', async () => {
      const created = await createPlanViaApi({
        title: 'No members',
        category: 'other',
        scheduledDate: '2026-06-01',
      });
      const res = await api<{ error: { code: string } }>(
        `${base}/${created.body.data.id}/toss`,
        { method: 'POST', token: ctx.token, body: {} },
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INCOMPLETE_PLAN');
    });

    it('TOSS 済みの予定を再度 TOSS すると 409 ALREADY_TOSSED', async () => {
      const created = await createPlanViaApi({
        title: 'Design',
        category: 'design',
        scheduledDate: '2026-06-01',
        fromMemberId: fromId,
        toMemberId: toId,
      });
      const planId = created.body.data.id;
      await api(`${base}/${planId}/toss`, { method: 'POST', token: ctx.token, body: {} });

      const res = await api<{ error: { code: string } }>(`${base}/${planId}/toss`, {
        method: 'POST',
        token: ctx.token,
        body: {},
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_TOSSED');
    });
  });
});
