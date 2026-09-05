import { describe, expect, it } from 'vitest';

import { api } from '../../test/request.js';
import {
  createMember,
  createOutsider,
  createProject,
  createUser,
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
            members: [
              { name: 'Client A', email: 'client-a@example.test', memberType: 'client' },
            ],
          },
        },
      );

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Launch Site');
      // 作成者は role_type によらず常に管理者 (FR-ROLE-04)
      expect(res.body.data.role).toBe('admin');
      // 作成者本人 + 招待先 1 名 = 2、制作物 2
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
});
