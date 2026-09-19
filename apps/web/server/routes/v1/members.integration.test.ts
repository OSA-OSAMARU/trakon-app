import { describe, expect, it } from 'vitest';

import { api } from '../../test/request.js';
import {
  createMember,
  createOrgMember,
  createOutsider,
  createUser,
  primaryOrganizationId,
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
      // 追加で参加者 (userId=null) を 1 名用意
      await createMember({
        projectId: project.id,
        userId: null,
        memberType: 'client',
      });

      const res = await api<{
        data: Array<{ id: string }>;
      }>(`/api/v1/projects/${project.id}/members`, { token });

      expect(res.status).toBe(200);
      // ディレクター本人 + 参加者 = 2
      expect(res.body.data).toHaveLength(2);
    });

    it('POST /members は組織メンバーをアカウント紐付きで追加し 201 を返す (#202)', async () => {
      const { token, project, user } = await setupProjectWithDirector();
      const organizationId = await primaryOrganizationId(user.id);
      const colleague = await createUser({ withOrganization: false });
      await createOrgMember({ organizationId, userId: colleague.id });

      const res = await api<{
        data: Array<{ id: string; name: string; email: string | null; userId: string | null; roleType: string }>;
      }>(`/api/v1/projects/${project.id}/members`, {
        method: 'POST',
        token,
        body: { members: [{ userId: colleague.id, memberType: 'client' }] },
      });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(1);
      // 氏名・メールは入力ではなくアカウントから引く (#156)
      expect(res.body.data[0]!.userId).toBe(colleague.id);
      expect(res.body.data[0]!.email).toBe(colleague.email);
      // 権限を省略したので組織の既定ロール (editor)
      expect(res.body.data[0]!.roleType).toBe('editor');
    });

    it('POST /members は組織外のユーザーを 422 NOT_ORGANIZATION_MEMBER で弾く (#202)', async () => {
      const { token, project } = await setupProjectWithDirector();
      // 別組織を持つユーザー
      const outsider = await createUser();

      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/members`,
        {
          method: 'POST',
          token,
          body: { members: [{ userId: outsider.id, memberType: 'client' }] },
        },
      );

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('NOT_ORGANIZATION_MEMBER');
    });

    it('POST /members は既に参加している相手を 409 ALREADY_MEMBER で弾く (#202)', async () => {
      const { token, project, user } = await setupProjectWithDirector();

      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/members`,
        {
          method: 'POST',
          token,
          body: { members: [{ userId: user.id, memberType: 'production' }] },
        },
      );

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_MEMBER');
    });

    it('POST /members/reorder はディレクターが並び替えでき、新しい順序を返す (#111)', async () => {
      const { token, project, member } = await setupProjectWithDirector();
      const b = await createMember({ projectId: project.id, userId: null, memberType: 'client' });
      const c = await createMember({ projectId: project.id, userId: null, memberType: 'client' });

      const res = await api<{ data: Array<{ id: string; sortOrder: number }> }>(
        `/api/v1/projects/${project.id}/members/reorder`,
        {
          method: 'POST',
          token,
          body: { orderedIds: [c.id, member.id, b.id] },
        },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.map((m) => m.id)).toEqual([c.id, member.id, b.id]);
      expect(res.body.data.map((m) => m.sortOrder)).toEqual([0, 1, 2]);
    });

    it('POST /members/reorder は id が過不足あると 422 INVALID_REORDER', async () => {
      const { token, project, member } = await setupProjectWithDirector();
      await createMember({ projectId: project.id, userId: null, memberType: 'client' });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/members/reorder`,
        {
          method: 'POST',
          token,
          body: { orderedIds: [member.id] }, // 追加メンバーが欠けている
        },
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_REORDER');
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
            members: [{ userId: crypto.randomUUID(), memberType: 'client' }],
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

    it('アカウント紐付け前の参加者行と同一メールなら 409 MEMBER_EMAIL_TAKEN', async () => {
      const { token, project, user } = await setupProjectWithDirector();
      const organizationId = await primaryOrganizationId(user.id);
      const colleague = await createUser({ withOrganization: false });
      await createOrgMember({ organizationId, userId: colleague.id });
      await createMember({
        projectId: project.id,
        userId: null,
        email: colleague.email,
        memberType: 'client',
      });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/members`,
        {
          method: 'POST',
          token,
          body: { members: [{ userId: colleague.id, memberType: 'client' }] },
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
