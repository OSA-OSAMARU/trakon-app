import { describe, expect, it } from 'vitest';

import { api } from '../../test/request.js';
import {
  createMember,
  createOutsider,
  createUser,
  setupProjectWithDirector,
} from '../../test/factories.js';
import { signTestJwt } from '../../test/auth.js';

// =============================================================================
// members ルートの統合テスト (実 DB + ミドルウェアチェーン)
// マウント先: /api/v1/projects/:projectId/members
// 一覧はメンバー、追加 / 更新 / 削除はディレクター限定。
// 正常系: 一覧 / 追加 / 更新 / 削除、異常系: 401 / 404 集約 / 422 / 業務エラー
// =============================================================================

describe('members routes (integration)', () => {
  describe('正常系', () => {
    it('GET /members はメンバーの一覧を返す', async () => {
      const { token, project } = await setupProjectWithDirector();
      // 追加で未受諾の仮メンバーを 1 名用意 (inviteStatus 確認用)
      await createMember({
        projectId: project.id,
        userId: null,
        memberType: 'client',
      });

      const res = await api<{
        data: Array<{ id: string; inviteStatus: string }>;
      }>(`/api/v1/projects/${project.id}/members`, { token });

      expect(res.status).toBe(200);
      // ディレクター本人 (accepted) + 仮メンバー (expired: 招待行なし) = 2
      expect(res.body.data).toHaveLength(2);
    });

    it('POST /members はディレクターが仮メンバーと招待を作成し 201 を返す', async () => {
      const { token, project } = await setupProjectWithDirector();

      const res = await api<{
        data: Array<{ id: string; email: string; inviteStatus: string }>;
      }>(`/api/v1/projects/${project.id}/members`, {
        method: 'POST',
        token,
        body: {
          members: [
            {
              name: 'Client A',
              email: 'client-a@example.test',
              organizationName: 'Acme',
              memberType: 'client',
            },
          ],
        },
      });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]!.email).toBe('client-a@example.test');
      expect(res.body.data[0]!.inviteStatus).toBe('pending');
    });

    it('PATCH /members/:memberId はディレクターがメンバーを更新できる', async () => {
      const { token, project } = await setupProjectWithDirector();
      const target = await createMember({
        projectId: project.id,
        userId: null,
        memberType: 'production',
      });

      const res = await api<{ data: { id: string; name: string; memberType: string } }>(
        `/api/v1/projects/${project.id}/members/${target.id}`,
        {
          method: 'PATCH',
          token,
          body: { name: 'Renamed', memberType: 'client' },
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Renamed');
      expect(res.body.data.memberType).toBe('client');
    });

    it('DELETE /members/:memberId はディレクターが他メンバーを削除でき 204 を返す', async () => {
      const { token, project } = await setupProjectWithDirector();
      const target = await createMember({
        projectId: project.id,
        userId: null,
        memberType: 'production',
      });

      const res = await api(
        `/api/v1/projects/${project.id}/members/${target.id}`,
        { method: 'DELETE', token },
      );

      expect(res.status).toBe(204);
    });
  });

  describe('異常系', () => {
    it('未認証は 401 AUTH_MISSING', async () => {
      const { project } = await setupProjectWithDirector();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/members`,
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_MISSING');
    });

    it('非メンバーの一覧取得は 404 に集約される', async () => {
      const { project } = await setupProjectWithDirector();
      const { token } = await createOutsider();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/members`,
        { token },
      );
      expect(res.status).toBe(404);
    });

    it('ディレクター以外のメンバーによる追加は 404 に集約される', async () => {
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
        `/api/v1/projects/${project.id}/members`,
        {
          method: 'POST',
          token,
          body: {
            members: [
              {
                name: 'X',
                email: 'x@example.test',
                organizationName: '',
                memberType: 'client',
              },
            ],
          },
        },
      );
      expect(res.status).toBe(404);
    });

    it('members が空の追加リクエストは 422', async () => {
      const { token, project } = await setupProjectWithDirector();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/members`,
        { method: 'POST', token, body: { members: [] } },
      );
      expect(res.status).toBe(422);
    });

    it('既存メンバーと同一メールの追加は 409 MEMBER_EMAIL_TAKEN', async () => {
      const { token, project } = await setupProjectWithDirector();
      await createMember({
        projectId: project.id,
        userId: null,
        email: 'dup@example.test',
        memberType: 'client',
      });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/members`,
        {
          method: 'POST',
          token,
          body: {
            members: [
              {
                name: 'Dup',
                email: 'dup@example.test',
                organizationName: '',
                memberType: 'client',
              },
            ],
          },
        },
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MEMBER_EMAIL_TAKEN');
    });

    it('ディレクター本人の自己削除は 409 CANNOT_REMOVE_SELF', async () => {
      const { token, project, member } = await setupProjectWithDirector();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/members/${member.id}`,
        { method: 'DELETE', token },
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CANNOT_REMOVE_SELF');
    });

    it('存在しないメンバーの更新は 404 NOT_FOUND', async () => {
      const { token, project } = await setupProjectWithDirector();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/members/${crypto.randomUUID()}`,
        { method: 'PATCH', token, body: { name: 'Ghost' } },
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
