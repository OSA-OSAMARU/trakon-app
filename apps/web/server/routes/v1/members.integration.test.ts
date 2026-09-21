import { describe, expect, it } from 'vitest';

import { prisma } from '@trakon/db';

import { api } from '../../test/request.js';
import {
  addProjectMemberWithRole,
  createMember,
  createOrgMember,
  createOutsider,
  createProjectWithAdmin,
  createUser,
  primaryOrganizationId,
  setupProjectWithDirector,
} from '../../test/factories.js';
import { signTestJwt } from '../../test/auth.js';
import { defaultInvitationExpiresAt, generateInvitationToken } from '../../lib/tokens.js';

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

// =============================================================================
// GET /members/candidates — 参加者に追加できる人 (#238)
//
// 「参加者を追加」の候補。ここが空になると追加ボタンが押せなくなるため、
// **誰を返すか**と**誰が引けるか**を固定する。
// =============================================================================

/** 別組織に招かれている利用者が、その組織のプロジェクトを管理している状況を作る */
async function setupGuestAdminOfHostOrg() {
  const host = await createUser();
  const hostOrgId = await primaryOrganizationId(host.id);

  // guest の既定組織は自分の個人組織。host の組織には一般会員として所属する
  const guest = await createUser();
  await createOrgMember({ organizationId: hostOrgId, userId: guest.id });

  const { project } = await createProjectWithAdmin({ user: guest, organizationId: hostOrgId });
  const token = await signTestJwt({ authUserId: guest.authUserId, email: guest.email });
  return { host, hostOrgId, guest, project, token };
}

type CandidatesBody = {
  data: {
    candidates: Array<{ userId: string; name: string; defaultProjectRole: string }>;
    joinedCount: number;
    pendingCount: number;
  };
};

describe('GET /members/candidates (#238)', () => {
  it('候補は**このプロジェクトの組織**から返る (利用者の既定組織ではない)', async () => {
    const { host, guest, project, token } = await setupGuestAdminOfHostOrg();
    // guest の既定組織 (個人組織) にだけ居る人。ここに混ざってはいけない
    const ownOrgOnly = await createUser({ withOrganization: false });
    await createOrgMember({
      organizationId: await primaryOrganizationId(guest.id),
      userId: ownOrgOnly.id,
    });

    const res = await api<CandidatesBody>(
      `/api/v1/projects/${project.id}/members/candidates`,
      { token },
    );

    expect(res.status).toBe(200);
    const ids = res.body.data.candidates.map((c) => c.userId);
    expect(ids).toContain(host.id);
    expect(ids).not.toContain(ownOrgOnly.id);
    // 自分は既に参加者なので候補から外れ、除外数に数えられる
    expect(ids).not.toContain(guest.id);
    expect(res.body.data.joinedCount).toBe(1);
  });

  it('組織の一般会員でも、プロジェクトの管理者なら候補を引ける', async () => {
    // 一覧 (/organizations/me/members) は組織の管理者限定。候補まで同じ扱いに
    // すると、招かれた側が自分のプロジェクトに誰も追加できなくなる
    const { project, token } = await setupGuestAdminOfHostOrg();

    const res = await api(`/api/v1/projects/${project.id}/members/candidates`, { token });

    expect(res.status).toBe(200);
  });

  it('未受諾の招待は候補に出さず、人数だけ返す (承諾すれば候補になる)', async () => {
    const { token, project, user } = await setupProjectWithDirector();
    const organizationId = await primaryOrganizationId(user.id);
    const { hash } = generateInvitationToken();
    await prisma.invitation.create({
      data: {
        organizationId,
        invitedByUserId: user.id,
        email: 'invitee@example.test',
        roleType: 'editor',
        tokenHash: hash,
        expiresAt: defaultInvitationExpiresAt(),
      },
    });

    const res = await api<CandidatesBody>(
      `/api/v1/projects/${project.id}/members/candidates`,
      { token },
    );

    expect(res.body.data.candidates).toHaveLength(0);
    expect(res.body.data.pendingCount).toBe(1);
  });

  it('メールだけ一致する未紐付けの参加者が居る人は候補に出さない', async () => {
    // 候補に出しても追加は MEMBER_EMAIL_TAKEN で弾かれる。選べるのに追加できない
    // 状態を作らないよう、サーバー側で先に外す
    const { token, project, user } = await setupProjectWithDirector();
    const organizationId = await primaryOrganizationId(user.id);
    const colleague = await createUser({ withOrganization: false });
    await createOrgMember({ organizationId, userId: colleague.id });
    await createMember({
      projectId: project.id,
      userId: null,
      email: colleague.email,
      memberType: 'production',
    });

    const res = await api<CandidatesBody>(
      `/api/v1/projects/${project.id}/members/candidates`,
      { token },
    );

    expect(res.body.data.candidates.map((c) => c.userId)).not.toContain(colleague.id);
    expect(res.body.data.joinedCount).toBe(2);
  });

  it('参加者を追加できない権限では 404 に集約する', async () => {
    const { project } = await setupProjectWithDirector();
    const editor = await addProjectMemberWithRole({ projectId: project.id, roleType: 'editor' });

    const res = await api(`/api/v1/projects/${project.id}/members/candidates`, {
      token: editor.token,
    });

    expect(res.status).toBe(404);
  });

  it('プロジェクト非参加者は 404', async () => {
    const { project } = await setupProjectWithDirector();
    const { token } = await createOutsider();

    const res = await api(`/api/v1/projects/${project.id}/members/candidates`, { token });

    expect(res.status).toBe(404);
  });
});
