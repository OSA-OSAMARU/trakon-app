import { describe, expect, it } from 'vitest';

import { api } from '../../test/request.js';
import {
  createItem,
  createMember,
  createOrgMember,
  createOutsider,
  createPlan,
  createProject,
  createUser,
  primaryOrganizationId,
  setupProjectWithDirector,
} from '../../test/factories.js';
import { signTestJwt } from '../../test/auth.js';

// =============================================================================
// projects ルートの統合テスト (実 DB + ミドルウェアチェーン)
// 正常系: 作成 / 一覧 / 詳細 / アーカイブ、異常系: 401 / 404 集約 / 422
// =============================================================================

describe('projects routes (integration)', () => {
  describe('正常系', () => {
    it('POST /projects は作成者を管理者としてプロジェクトを作成する', async () => {
      const user = await createUser();
      const organizationId = await primaryOrganizationId(user.id);
      const colleague = await createUser({ withOrganization: false });
      await createOrgMember({ organizationId, userId: colleague.id });
      const token = await signTestJwt({
        authUserId: user.authUserId,
        email: user.email,
      });

      const res = await api<{ data: { id: string; name: string; role: string; counts: { memberCount: number; itemCount: number } } }>(
        '/api/v1/projects',
        {
          method: 'POST',
          token,
          body: {
            name: 'Launch Site',
            startDate: '2026-01-01',
            endDate: '2026-03-31',
            items: [{ name: 'LP' }, { name: 'OGP' }],
            // 参加者は組織メンバーから選ぶ (#202)
            members: [{ userId: colleague.id, memberType: 'client' }],
          },
        },
      );

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Launch Site');
      // 作成者は role_type によらず常に管理者 (FR-ROLE-04)
      expect(res.body.data.role).toBe('admin');
      // 作成者本人 + 参加者 1 名 = 2、制作物 2
      expect(res.body.data.counts).toEqual({ memberCount: 2, itemCount: 2 });
    });

    it('GET /projects は自分が参加するプロジェクトのみ返す', async () => {
      const { token } = await setupProjectWithDirector();
      // 別ユーザーのプロジェクト (見えてはいけない)
      const stranger = await createUser();
      await createProject({ createdBy: stranger.id });

      const res = await api<{ data: unknown[]; meta: { total: number } }>(
        '/api/v1/projects',
        { token },
      );
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data).toHaveLength(1);
    });

    it('GET /projects/:id はメンバーに詳細を返す', async () => {
      const { token, project } = await setupProjectWithDirector();
      const res = await api<{ data: { id: string } }>(
        `/api/v1/projects/${project.id}`,
        { token },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(project.id);
    });

    it('POST /projects/:id/archive はディレクターが実行でき archivedAt が立つ', async () => {
      const { token, project } = await setupProjectWithDirector();
      const res = await api<{ data: { archivedAt: string | null } }>(
        `/api/v1/projects/${project.id}/archive`,
        { method: 'POST', token },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.archivedAt).not.toBeNull();
    });
  });

  describe('異常系', () => {
    it('未認証は 401 AUTH_MISSING', async () => {
      const res = await api<{ error: { code: string } }>('/api/v1/projects');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_MISSING');
    });

    it('プロフィール未完成 (users 行なし) は 404 PROFILE_NOT_COMPLETED', async () => {
      // DB に users 行を作らず、トークンだけ発行する
      const token = await signTestJwt({
        authUserId: crypto.randomUUID(),
        email: 'ghost@example.test',
      });
      const res = await api<{ error: { code: string } }>('/api/v1/projects', { token });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PROFILE_NOT_COMPLETED');
    });

    it('非メンバーの詳細取得は 404 に集約される', async () => {
      const { project } = await setupProjectWithDirector();
      const { token } = await createOutsider();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}`,
        { token },
      );
      expect(res.status).toBe(404);
    });

    it('ディレクター以外のメンバーによる更新は 404 に集約される', async () => {
      const { project } = await setupProjectWithDirector();
      // production メンバーだが createdBy ではない別ユーザー
      const member = await createUser();
      await createMember({
        projectId: project.id,
        userId: member.id,
        memberType: 'production',
      });
      const token = await signTestJwt({
        authUserId: member.authUserId,
        email: member.email,
      });
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}`,
        { method: 'PATCH', token, body: { name: 'hijacked' } },
      );
      expect(res.status).toBe(404);
    });

    it('items が空の作成リクエストは 422', async () => {
      const user = await createUser();
      const token = await signTestJwt({
        authUserId: user.authUserId,
        email: user.email,
      });
      const res = await api<{ error: { code: string } }>('/api/v1/projects', {
        method: 'POST',
        token,
        body: {
          name: 'No Items',
          startDate: '2026-01-01',
          endDate: '2026-03-31',
          items: [],
        },
      });
      expect(res.status).toBe(422);
    });
  });
  // ---------------------------------------------------------------------------
  // プロジェクト期間の変更ガード (#155)
  //
  // 縦型スケジュールは行軸をプロジェクト期間から作るため、期間の外に出た予定は
  // 描画先の行が無く、FE 側で端の行へクランプされて壊れて見える。期間の変更で
  // 既存予定がはみ出す場合は 409 で拒否する。
  // ---------------------------------------------------------------------------
  describe('期間変更ガード (#155)', () => {
    async function setupWithPlan(planDates: { scheduledDate: Date; dueDate?: Date | null }) {
      const user = await createUser();
      const project = await createProject({
        createdBy: user.id,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-30'),
      });
      await createMember({
        projectId: project.id,
        userId: user.id,
        name: user.fullName,
        email: user.email,
        memberType: 'production',
        roleType: 'admin',
      });
      const item = await createItem({ projectId: project.id });
      await createPlan({ itemId: item.id, ...planDates });
      const token = await signTestJwt({ authUserId: user.authUserId, email: user.email });
      return { project, token };
    }

    it('既存予定を含む範囲への変更は成功する', async () => {
      const { project, token } = await setupWithPlan({
        scheduledDate: new Date('2026-06-10'),
        dueDate: new Date('2026-06-15'),
      });
      const res = await api<{ data: { startDate: string; endDate: string } }>(
        `/api/v1/projects/${project.id}`,
        { method: 'PATCH', token, body: { startDate: '2026-06-05', endDate: '2026-07-31' } },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.startDate).toBe('2026-06-05');
      expect(res.body.data.endDate).toBe('2026-07-31');
    });

    it('開始日を予定より後ろへ動かすと 409 PLANS_OUT_OF_RANGE', async () => {
      const { project, token } = await setupWithPlan({ scheduledDate: new Date('2026-06-10') });
      const res = await api<{ error: { code: string; details: { outOfRangeCount: number } } }>(
        `/api/v1/projects/${project.id}`,
        { method: 'PATCH', token, body: { startDate: '2026-06-20' } },
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PLANS_OUT_OF_RANGE');
      expect(res.body.error.details.outOfRangeCount).toBe(1);
    });

    it('終了日を予定の終了日より手前へ動かすと 409 (dueDate も見る)', async () => {
      const { project, token } = await setupWithPlan({
        scheduledDate: new Date('2026-06-10'),
        dueDate: new Date('2026-06-25'),
      });
      const res = await api<{ error: { code: string } }>(`/api/v1/projects/${project.id}`, {
        method: 'PATCH',
        token,
        body: { endDate: '2026-06-20' },
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PLANS_OUT_OF_RANGE');
    });

    it('境界ちょうど (予定の端 = 期間の端) は成功する', async () => {
      const { project, token } = await setupWithPlan({
        scheduledDate: new Date('2026-06-10'),
        dueDate: new Date('2026-06-20'),
      });
      const res = await api(`/api/v1/projects/${project.id}`, {
        method: 'PATCH',
        token,
        body: { startDate: '2026-06-10', endDate: '2026-06-20' },
      });
      expect(res.status).toBe(200);
    });

    it('予定が 1 件も無ければ任意の期間へ変更できる', async () => {
      const { project, token } = await setupProjectWithDirector();
      const res = await api(`/api/v1/projects/${project.id}`, {
        method: 'PATCH',
        token,
        body: { startDate: '2027-01-01', endDate: '2027-01-31' },
      });
      expect(res.status).toBe(200);
    });

    it('終了日だけの PATCH でも保存済みの開始日と突き合わせる (422)', async () => {
      const { project, token } = await setupProjectWithDirector();
      // 保存済みは 2026-01-01 〜 2026-12-31。endDate だけを開始日より前に送る。
      const res = await api<{ error: { code: string } }>(`/api/v1/projects/${project.id}`, {
        method: 'PATCH',
        token,
        body: { endDate: '2025-12-31' },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_PROJECT_PERIOD');
    });

    it('期間を触らない更新は予定がはみ出していても成功する', async () => {
      const { project, token } = await setupWithPlan({ scheduledDate: new Date('2026-06-10') });
      const res = await api(`/api/v1/projects/${project.id}`, {
        method: 'PATCH',
        token,
        body: { name: '名前だけ変更' },
      });
      expect(res.status).toBe(200);
    });

    it('GET /projects/:id は予定の日付範囲 (plansDateRange) を返す', async () => {
      const { project, token } = await setupWithPlan({
        scheduledDate: new Date('2026-06-10'),
        dueDate: new Date('2026-06-15'),
      });
      const res = await api<{
        data: { plansDateRange: { min: string; max: string; count: number } | null };
      }>(`/api/v1/projects/${project.id}`, { token });
      expect(res.status).toBe(200);
      expect(res.body.data.plansDateRange).toEqual({
        min: '2026-06-10',
        max: '2026-06-15',
        count: 1,
      });
    });
  });
});
