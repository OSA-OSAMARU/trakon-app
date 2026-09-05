import { prisma } from '@trakon/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __setMailerForTest, type InvitationEmail } from '../lib/mailer.js';
import { hashToken } from '../lib/tokens.js';
import {
  addProjectMemberWithRole,
  createMember,
  createUser,
  setupProjectWithDirector,
} from '../test/factories.js';
import { api } from '../test/request.js';
import { signTestJwt } from '../test/auth.js';

// =============================================================================
// 招待の作成・受諾 (設計書 §7.12.5)
//
// Phase 0 では受諾側しか実装されておらず、lib/tokens.ts と lib/mailer.ts は
// 一度も使われていなかった。ここで初めて通しで検証する。
// =============================================================================

let sent: InvitationEmail[] = [];

beforeEach(() => {
  sent = [];
  __setMailerForTest({
    async sendInvitation(input) {
      sent.push(input);
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /projects/:projectId/invitations', () => {
  describe('正常系', () => {
    it('参加者行を新規作成し、ロール付きの招待メールを送る', async () => {
      const { project, token } = await setupProjectWithDirector();

      const res = await api<{ data: { id: string; email: string; roleType: string } }>(
        `/api/v1/projects/${project.id}/invitations`,
        {
          method: 'POST',
          token,
          body: { email: 'Invitee@Example.test', roleType: 'viewer', name: '招待 太郎' },
        },
      );

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ email: 'invitee@example.test', roleType: 'viewer' });

      // 参加者行が作られ、受諾前でもロールが見える
      const member = await prisma.projectMember.findFirstOrThrow({
        where: { projectId: project.id, email: 'invitee@example.test' },
      });
      expect(member).toMatchObject({ userId: null, roleType: 'viewer', name: '招待 太郎' });

      // 招待メールが 1 通、受諾 URL 付きで送られる
      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe('invitee@example.test');
      expect(sent[0]?.acceptUrl).toMatch(/\/invitations\/[A-Za-z0-9_-]{20,}$/);

      // 生トークンは保存せずハッシュのみ (SR-AUTH-02)
      const rawToken = sent[0]!.acceptUrl.split('/').pop()!;
      const invitation = await prisma.invitation.findFirstOrThrow({
        where: { projectId: project.id },
      });
      expect(invitation.tokenHash).toBe(hashToken(rawToken));
      expect(invitation.organizationId).toBe(project.organizationId);
    });

    it('メール未登録の既存担当者行にメールを付けて招待できる', async () => {
      const { project, token } = await setupProjectWithDirector();
      const member = await createMember({
        projectId: project.id,
        userId: null,
        email: undefined,
        roleType: 'editor',
      });
      await prisma.projectMember.update({ where: { id: member.id }, data: { email: null } });

      const res = await api(`/api/v1/projects/${project.id}/invitations`, {
        method: 'POST',
        token,
        body: { email: 'assignee@example.test', roleType: 'admin', memberId: member.id },
      });

      expect(res.status).toBe(201);
      const updated = await prisma.projectMember.findUniqueOrThrow({ where: { id: member.id } });
      expect(updated).toMatchObject({ email: 'assignee@example.test', roleType: 'admin' });
      // 新しい参加者行は増えない
      expect(await prisma.projectMember.count({ where: { projectId: project.id } })).toBe(2);
    });

    it('監査ログに invitation_created が残る', async () => {
      const { project, token, user } = await setupProjectWithDirector();

      await api(`/api/v1/projects/${project.id}/invitations`, {
        method: 'POST',
        token,
        body: { email: 'audit@example.test', roleType: 'editor' },
      });

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'invitation_created' },
      });
      expect(log.actorUserId).toBe(user.id);
      expect(log.extra).toMatchObject({ projectId: project.id, roleType: 'editor' });
    });
  });

  describe('異常系', () => {
    it('同一プロジェクトに同じメールが既にあれば 409 MEMBER_EMAIL_TAKEN', async () => {
      const { project, token } = await setupProjectWithDirector();
      await createMember({ projectId: project.id, email: 'dup@example.test' });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/invitations`,
        { method: 'POST', token, body: { email: 'dup@example.test', roleType: 'editor' } },
      );

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MEMBER_EMAIL_TAKEN');
      expect(sent).toHaveLength(0);
    });

    it('既に参加済みの担当者行は 409 ALREADY_MEMBER', async () => {
      const { project, token } = await setupProjectWithDirector();
      const joined = await addProjectMemberWithRole({ projectId: project.id, roleType: 'editor' });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/invitations`,
        {
          method: 'POST',
          token,
          body: { email: 'other@example.test', roleType: 'editor', memberId: joined.member.id },
        },
      );

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_MEMBER');
    });

    it.each(['editor', 'viewer'] as const)('%s は招待を作成できない (404)', async (role) => {
      const { project } = await setupProjectWithDirector();
      const other = await addProjectMemberWithRole({ projectId: project.id, roleType: role });

      const res = await api(`/api/v1/projects/${project.id}/invitations`, {
        method: 'POST',
        token: other.token,
        body: { email: 'nope@example.test', roleType: 'editor' },
      });

      expect(res.status).toBe(404);
    });

    it('メール送信に失敗しても招待は残り warnings を返す', async () => {
      __setMailerForTest({
        async sendInvitation() {
          throw new Error('resend unavailable');
        },
      });
      const { project, token } = await setupProjectWithDirector();

      const res = await api<{ warnings?: string[] }>(
        `/api/v1/projects/${project.id}/invitations`,
        { method: 'POST', token, body: { email: 'fail@example.test', roleType: 'editor' } },
      );

      expect(res.status).toBe(201);
      expect(res.body.warnings?.[0]).toContain('メールの送信に失敗');
      expect(await prisma.invitation.count({ where: { projectId: project.id } })).toBe(1);
    });
  });
});

describe('GET / DELETE /projects/:projectId/invitations', () => {
  it('未受諾の招待だけを返し、取り消すと一覧から消える', async () => {
    const { project, token } = await setupProjectWithDirector();
    await api(`/api/v1/projects/${project.id}/invitations`, {
      method: 'POST',
      token,
      body: { email: 'pending@example.test', roleType: 'editor' },
    });

    const list = await api<{ data: Array<{ id: string }> }>(
      `/api/v1/projects/${project.id}/invitations`,
      { token },
    );
    expect(list.body.data).toHaveLength(1);

    const revoked = await api(
      `/api/v1/projects/${project.id}/invitations/${list.body.data[0]!.id}`,
      { method: 'DELETE', token },
    );
    expect(revoked.status).toBe(204);

    const after = await api<{ data: unknown[] }>(`/api/v1/projects/${project.id}/invitations`, {
      token,
    });
    expect(after.body.data).toHaveLength(0);
  });
});

describe('POST /invitations/:token/accept', () => {
  it('招待されたロールが付与され、組織の会員として座席を消費する', async () => {
    const { project, token } = await setupProjectWithDirector();
    const invitee = await createUser({ email: 'accept@example.test', withOrganization: false });
    await api(`/api/v1/projects/${project.id}/invitations`, {
      method: 'POST',
      token,
      body: { email: 'accept@example.test', roleType: 'admin' },
    });
    const rawToken = sent[0]!.acceptUrl.split('/').pop()!;
    const inviteeToken = await signTestJwt({
      authUserId: invitee.authUserId,
      email: invitee.email,
    });

    const res = await api<{ data: { member: { roleType: string } } }>(
      `/api/v1/invitations/${rawToken}/accept`,
      { method: 'POST', token: inviteeToken },
    );

    // 受諾は参加者行を作るため 201 (Phase 0 からの既存挙動)
    expect(res.status).toBe(201);
    expect(res.body.data.member.roleType).toBe('admin');

    // プロジェクト参加者にロールが反映される
    const member = await prisma.projectMember.findFirstOrThrow({
      where: { projectId: project.id, userId: invitee.id },
    });
    expect(member.roleType).toBe('admin');

    // 組織の会員として追加される (= 座席を 1 つ消費)
    const orgMember = await prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: project.organizationId, userId: invitee.id },
    });
    expect(orgMember).toMatchObject({ orgRole: 'member', deletedAt: null });

    // 監査ログ
    expect(
      await prisma.auditLog.count({ where: { action: 'org_member_added', actorUserId: invitee.id } }),
    ).toBe(1);
  });

  it('取り消された招待は受諾できない (404 集約)', async () => {
    const { project, token } = await setupProjectWithDirector();
    const invitee = await createUser({ email: 'revoked@example.test', withOrganization: false });
    const created = await api<{ data: { id: string } }>(
      `/api/v1/projects/${project.id}/invitations`,
      { method: 'POST', token, body: { email: 'revoked@example.test', roleType: 'editor' } },
    );
    const rawToken = sent[0]!.acceptUrl.split('/').pop()!;
    await api(`/api/v1/projects/${project.id}/invitations/${created.body.data.id}`, {
      method: 'DELETE',
      token,
    });
    const inviteeToken = await signTestJwt({
      authUserId: invitee.authUserId,
      email: invitee.email,
    });

    const res = await api(`/api/v1/invitations/${rawToken}/accept`, {
      method: 'POST',
      token: inviteeToken,
    });

    expect(res.status).toBe(404);
  });
});
