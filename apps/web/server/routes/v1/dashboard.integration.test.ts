import { describe, expect, it } from 'vitest';

import { api } from '../../test/request.js';
import {
  createItem,
  createPlan,
  setupProjectWithDirector,
} from '../../test/factories.js';
import { signTestJwt } from '../../test/auth.js';

// =============================================================================
// dashboard ルートの統合テスト (実 DB + ミドルウェアチェーン)
// GET /api/v1/users/me/dashboard
// 正常系: 空 / 集計あり / ?today= 分岐、異常系: 401 / プロフィール未完成 / 422
// =============================================================================

type DashboardBody = {
  data: {
    today: string;
    summary: { todayTaskCount: number; overdueCount: number };
    projects: Array<{
      id: string;
      name: string;
      memberSections: Array<{
        member: { id: string };
        tasks: Array<{ planId: string; isOverdue: boolean; ballState: string }>;
      }>;
    }>;
  };
};

const PATH = '/api/v1/users/me/dashboard';

describe('dashboard routes (integration)', () => {
  describe('正常系', () => {
    it('参加プロジェクトに対象予定が無いと空集計を返す', async () => {
      const { token } = await setupProjectWithDirector();
      const res = await api<DashboardBody>(PATH, { token });
      expect(res.status).toBe(200);
      expect(res.body.data.summary).toEqual({ todayTaskCount: 0, overdueCount: 0 });
      expect(res.body.data.projects).toEqual([]);
    });

    it('今日以前の active な予定を holder ごとに集計する (?today= 指定)', async () => {
      const ctx = await setupProjectWithDirector();
      const item = await createItem({ projectId: ctx.project.id });
      // イベント無し → holder=from(ctx.member), state=ready
      const plan = await createPlan({
        itemId: item.id,
        executorMemberId: ctx.member.id,
        // イベント未発生時のホルダーは from。to は CHECK 制約 (from<>to) 回避のため未設定。
        toMemberId: null,
        scheduledDate: new Date('2026-06-01'),
        status: 'active',
      });

      const res = await api<DashboardBody>(`${PATH}?today=2026-06-21`, {
        token: ctx.token,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.today).toBe('2026-06-21');
      expect(res.body.data.summary.todayTaskCount).toBe(1);
      expect(res.body.data.projects).toHaveLength(1);
      const section = res.body.data.projects[0]!.memberSections[0]!;
      expect(section.member.id).toBe(ctx.member.id);
      expect(section.tasks.map((t) => t.planId)).toContain(plan.id);
      expect(section.tasks[0]!.ballState).toBe('in_progress');
    });

    it('dueDate が today より前なら isOverdue=true で overdueCount に計上する', async () => {
      const ctx = await setupProjectWithDirector();
      const item = await createItem({ projectId: ctx.project.id });
      await createPlan({
        itemId: item.id,
        executorMemberId: ctx.member.id,
        // イベント未発生時のホルダーは from。to は CHECK 制約 (from<>to) 回避のため未設定。
        toMemberId: null,
        scheduledDate: new Date('2026-06-01'),
        dueDate: new Date('2026-06-10'),
        status: 'active',
      });

      const res = await api<DashboardBody>(`${PATH}?today=2026-06-21`, {
        token: ctx.token,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.overdueCount).toBe(1);
      const task = res.body.data.projects[0]!.memberSections[0]!.tasks[0]!;
      expect(task.isOverdue).toBe(true);
    });

    it('未来日 (scheduledDate > today) の予定は集計対象外', async () => {
      const ctx = await setupProjectWithDirector();
      const item = await createItem({ projectId: ctx.project.id });
      await createPlan({
        itemId: item.id,
        executorMemberId: ctx.member.id,
        // イベント未発生時のホルダーは from。to は CHECK 制約 (from<>to) 回避のため未設定。
        toMemberId: null,
        scheduledDate: new Date('2026-12-01'),
        status: 'active',
      });

      const res = await api<DashboardBody>(`${PATH}?today=2026-06-21`, {
        token: ctx.token,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.todayTaskCount).toBe(0);
      expect(res.body.data.projects).toEqual([]);
    });

    it('別ユーザーのプロジェクトは集計に含めない', async () => {
      const ctx = await setupProjectWithDirector();
      // 別ユーザーのプロジェクト + 今日の予定 (見えてはいけない)
      const stranger = await setupProjectWithDirector();
      const strangerItem = await createItem({ projectId: stranger.project.id });
      await createPlan({
        itemId: strangerItem.id,
        executorMemberId: stranger.member.id,
        toMemberId: null,
        scheduledDate: new Date('2026-06-01'),
        status: 'active',
      });

      const res = await api<DashboardBody>(`${PATH}?today=2026-06-21`, {
        token: ctx.token,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.todayTaskCount).toBe(0);
      expect(res.body.data.projects).toEqual([]);
    });
  });

  describe('異常系', () => {
    it('未認証は 401 AUTH_MISSING', async () => {
      const res = await api<{ error: { code: string } }>(PATH);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_MISSING');
    });

    it('プロフィール未完成 (users 行なし) は 404 PROFILE_NOT_COMPLETED', async () => {
      const token = await signTestJwt({
        authUserId: crypto.randomUUID(),
        email: 'ghost@example.test',
      });
      const res = await api<{ error: { code: string } }>(PATH, { token });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PROFILE_NOT_COMPLETED');
    });

    it('today が不正な形式だと 422', async () => {
      const { token } = await setupProjectWithDirector();
      const res = await api<{ error: { code: string } }>(`${PATH}?today=2026/06/21`, {
        token,
      });
      expect(res.status).toBe(422);
    });
  });
});
