import { prisma } from '@trakon/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { __setMailerForTest, type Mailer } from '../../lib/mailer.js';
import { signTestJwt } from '../../test/auth.js';
import {
  createMember,
  createProjectWithAdmin,
  createUser,
  primaryOrganizationId,
  setBillingSubscription,
} from '../../test/factories.js';
import { api } from '../../test/request.js';

// =============================================================================
// 組織のメンバー管理 (#160) — Figma node 406:22
//
// 「座席の台帳」としての一覧・権限変更・組織単位の招待・参加PJ の取得を検証する。
// フリープランの「表示されるだけの参加者」(user_id NULL) はここに出ないこと、
// 権限変更が参加中のプロジェクトへ反映されることが要点。
// =============================================================================

type SentInvitation = {
  to: string;
  organizationName: string;
  projectNames: string[];
  acceptUrl: string;
};
let sent: SentInvitation[] = [];

let owner: Awaited<ReturnType<typeof createUser>>;
let ownerToken: string;
let organizationId: string;

beforeEach(async () => {
  sent = [];
  const mailer: Partial<Mailer> = {
    async sendInvitation(input) {
      sent.push({
        to: input.to,
        organizationName: input.organizationName,
        projectNames: input.projectNames,
        acceptUrl: input.acceptUrl,
      });
    },
  };
  __setMailerForTest(mailer);

  owner = await createUser();
  organizationId = await primaryOrganizationId(owner.id);
  ownerToken = await signTestJwt({ authUserId: owner.authUserId, email: owner.email });
  // 招待できるプランにしておく (Free は招待そのものができない)
  await setBillingSubscription({ organizationId, planCode: 'team', status: 'active' });
});

type MembersBody = {
  data: Array<{
    userId: string | null;
    invitationId: string | null;
    status: 'active' | 'invited';
    name: string;
    email: string;
    organizationName: string | null;
    jobTitle: string | null;
    defaultProjectRole: string;
    projectCount: number;
  }>;
};

describe('GET /organizations/me/members', () => {
  it('会員と保留中の招待を 1 つの一覧で返す', async () => {
    await api('/api/v1/organizations/me/invitations', {
      method: 'POST',
      token: ownerToken,
      body: { name: '石原 美咲', email: 'misaki@example.test', roleType: 'editor' },
    });

    const res = await api<MembersBody>('/api/v1/organizations/me/members', { token: ownerToken });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const active = res.body.data.find((m) => m.status === 'active');
    const invited = res.body.data.find((m) => m.status === 'invited');
    expect(active?.userId).toBe(owner.id);
    expect(active?.defaultProjectRole).toBe('admin'); // オーナーは常に管理者
    expect(invited?.name).toBe('石原 美咲');
    expect(invited?.invitationId).not.toBeNull();
    // 招待中は本人がまだ何も設定していないので所属・職種は空
    expect(invited?.organizationName).toBeNull();
    expect(invited?.jobTitle).toBeNull();
  });

  it('アカウントを持たない「表示されるだけの参加者」は出てこない (#160 の差別化)', async () => {
    const { project } = await createProjectWithAdmin({ user: owner });
    await createMember({ projectId: project.id, userId: null, name: '表示だけの人' });

    const res = await api<MembersBody>('/api/v1/organizations/me/members', { token: ownerToken });

    expect(res.body.data.map((m) => m.name)).not.toContain('表示だけの人');
  });

  it('参加プロジェクト数を返す', async () => {
    await createProjectWithAdmin({ user: owner, name: 'A' });
    await createProjectWithAdmin({ user: owner, name: 'B' });

    const res = await api<MembersBody>('/api/v1/organizations/me/members', { token: ownerToken });

    expect(res.body.data.find((m) => m.userId === owner.id)?.projectCount).toBe(2);
  });

  it('プロフィールはマイページの値を返す (#156 の read-through)', async () => {
    await api('/api/v1/auth/me', {
      method: 'PATCH',
      token: ownerToken,
      body: {
        organizationName: 'おさまるカンパニー',
        jobTitle: 'director',
        notificationEmail: 'notify@example.test',
      },
    });

    const res = await api<MembersBody>('/api/v1/organizations/me/members', { token: ownerToken });
    const me = res.body.data.find((m) => m.userId === owner.id);

    expect(me?.organizationName).toBe('おさまるカンパニー');
    expect(me?.jobTitle).toBe('director');
    expect(me?.email).toBe('notify@example.test');
  });

  it('一般の会員は一覧を見られない (同僚の連絡先を含むため)', async () => {
    const member = await createUser({ withOrganization: false });
    await prisma.organizationMember.create({
      data: { organizationId, userId: member.id, orgRole: 'member' },
    });
    const token = await signTestJwt({ authUserId: member.authUserId, email: member.email });

    const res = await api('/api/v1/organizations/me/members', { token });

    expect(res.status).toBe(403);
  });
});

describe('GET /organizations/me/members/candidates (#238)', () => {
  it('一般の会員でも候補は引ける (プロジェクト作成時に参加者を選べなくなるため)', async () => {
    const member = await createUser({ withOrganization: false });
    await prisma.organizationMember.create({
      data: { organizationId, userId: member.id, orgRole: 'member' },
    });
    const token = await signTestJwt({ authUserId: member.authUserId, email: member.email });

    const res = await api<{
      data: { candidates: Array<{ userId: string; name: string; defaultProjectRole: string }> };
    }>('/api/v1/organizations/me/members/candidates', { token });

    expect(res.status).toBe(200);
    expect(res.body.data.candidates.map((c) => c.userId)).toEqual(
      expect.arrayContaining([owner.id, member.id]),
    );
  });

  it('候補には連絡先を含めない (一覧との違い)', async () => {
    const res = await api<{ data: { candidates: Array<Record<string, unknown>> } }>(
      '/api/v1/organizations/me/members/candidates',
      { token: ownerToken },
    );

    const me = res.body.data.candidates[0]!;
    expect(me).not.toHaveProperty('email');
    expect(me).not.toHaveProperty('jobTitle');
  });
});

describe('POST /organizations/me/invitations', () => {
  it('プロジェクト未選択でも招待でき、メールが飛ぶ', async () => {
    const res = await api<{ data: { id: string } }>('/api/v1/organizations/me/invitations', {
      method: 'POST',
      token: ownerToken,
      body: { name: '横山 美咲', email: 'yokoyama@example.test', roleType: 'editor' },
    });

    expect(res.status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('yokoyama@example.test');

    const inv = await prisma.invitation.findUniqueOrThrow({ where: { id: res.body.data.id } });
    // 組織単位なのでプロジェクトには紐づかない (ck_inv_scope)
    expect(inv.projectId).toBeNull();
    expect(inv.invitedMemberId).toBeNull();
    expect(inv.invitedName).toBe('横山 美咲');
  });

  it('プロジェクトを選ぶと受諾前から参加者行ができる', async () => {
    const { project } = await createProjectWithAdmin({ user: owner });

    await api('/api/v1/organizations/me/invitations', {
      method: 'POST',
      token: ownerToken,
      body: {
        name: '杉野 健太',
        email: 'sugino@example.test',
        roleType: 'viewer',
        projectIds: [project.id],
      },
    });

    const member = await prisma.projectMember.findFirstOrThrow({
      where: { projectId: project.id, email: 'sugino@example.test' },
    });
    expect(member.userId).toBeNull();
    expect(member.roleType).toBe('viewer');
  });

  it('メールと受諾画面に、参加するプロジェクト名を出す (#258)', async () => {
    const a = await createProjectWithAdmin({ user: owner });
    const b = await createProjectWithAdmin({ user: owner });

    await api('/api/v1/organizations/me/invitations', {
      method: 'POST',
      token: ownerToken,
      body: {
        name: '宮丸 一郎',
        email: 'miyamaru@example.test',
        roleType: 'viewer',
        projectIds: [a.project.id, b.project.id],
      },
    });

    // 招待メール
    expect(sent[0]!.projectNames).toEqual([a.project.name, b.project.name]);

    // 受諾画面 (未認証でも見られる)
    const rawToken = sent[0]!.acceptUrl.split('/').pop()!;
    const verify = await api<{
      data: { scope: string; project: unknown; projects: Array<{ id: string; name: string }> };
    }>(`/api/v1/invitations/${rawToken}`);

    expect(verify.status).toBe(200);
    expect(verify.body.data.scope).toBe('org');
    expect(verify.body.data.project).toBeNull();
    expect(verify.body.data.projects.map((p) => p.id).sort()).toEqual(
      [a.project.id, b.project.id].sort(),
    );
  });

  it('プロジェクトを選ばない招待では、参加するプロジェクトは空になる (#258)', async () => {
    await api('/api/v1/organizations/me/invitations', {
      method: 'POST',
      token: ownerToken,
      body: { name: '組織だけ', email: 'org-only@example.test', roleType: 'viewer' },
    });

    expect(sent[0]!.projectNames).toEqual([]);

    const rawToken = sent[0]!.acceptUrl.split('/').pop()!;
    const verify = await api<{ data: { projects: unknown[] } }>(
      `/api/v1/invitations/${rawToken}`,
    );

    expect(verify.body.data.projects).toEqual([]);
  });

  it('受諾すると組織メンバーになり、選ばれていたプロジェクトにも紐づく', async () => {
    const { project } = await createProjectWithAdmin({ user: owner });
    const res = await api<{ data: { id: string } }>('/api/v1/organizations/me/invitations', {
      method: 'POST',
      token: ownerToken,
      body: {
        name: '受諾 太郎',
        email: 'accept@example.test',
        organizationName: '博報堂',
        jobTitle: 'designer',
        roleType: 'editor',
        projectIds: [project.id],
      },
    });
    void res;
    const rawToken = sent[0]!.acceptUrl.split('/').pop()!;

    const invitee = await createUser({ email: 'accept@example.test', withOrganization: false });
    const inviteeToken = await signTestJwt({
      authUserId: invitee.authUserId,
      email: invitee.email,
    });

    const accepted = await api<{
      data: { scope: string; project: null; members: Array<{ projectId: string }> };
    }>(`/api/v1/invitations/${rawToken}/accept`, { method: 'POST', token: inviteeToken });

    expect(accepted.status).toBe(201);
    expect(accepted.body.data.scope).toBe('org');
    expect(accepted.body.data.project).toBeNull();
    expect(accepted.body.data.members.map((m) => m.projectId)).toEqual([project.id]);

    // 組織メンバーになり、招待のロールが既定ロールになる
    const orgMember = await prisma.organizationMember.findFirstOrThrow({
      where: { organizationId, userId: invitee.id },
    });
    expect(orgMember.defaultProjectRole).toBe('editor');

    // 所属名 / 職種はアカウント側へ引き継がれる (#156)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } });
    expect(user.organizationName).toBe('博報堂');
    expect(user.jobTitle).toBe('designer');
  });

  it('既に会員のメールは 409 ALREADY_MEMBER', async () => {
    const res = await api<{ error: { code: string } }>('/api/v1/organizations/me/invitations', {
      method: 'POST',
      token: ownerToken,
      body: { name: '本人', email: owner.email, roleType: 'editor' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_MEMBER');
  });

  it('招待中のメールを再招待すると 409 INVITATION_ALREADY_SENT', async () => {
    const body = { name: 'A', email: 'dup@example.test', roleType: 'editor' };
    await api('/api/v1/organizations/me/invitations', { method: 'POST', token: ownerToken, body });

    const res = await api<{ error: { code: string } }>('/api/v1/organizations/me/invitations', {
      method: 'POST',
      token: ownerToken,
      body,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVITATION_ALREADY_SENT');
  });

  it('取り消すと枠が解放される', async () => {
    const created = await api<{ data: { id: string } }>('/api/v1/organizations/me/invitations', {
      method: 'POST',
      token: ownerToken,
      body: { name: 'B', email: 'revoke@example.test', roleType: 'editor' },
    });

    const before = await api<MembersBody>('/api/v1/organizations/me/members', { token: ownerToken });
    expect(before.body.data).toHaveLength(2);

    const res = await api(`/api/v1/organizations/me/invitations/${created.body.data.id}`, {
      method: 'DELETE',
      token: ownerToken,
    });
    expect(res.status).toBe(204);

    const after = await api<MembersBody>('/api/v1/organizations/me/members', { token: ownerToken });
    expect(after.body.data).toHaveLength(1);
  });
});

describe('POST /organizations/me/invitations/:invitationId/resend — 招待の再送 (#230)', () => {
  async function invite(email = 'resend@example.test') {
    const created = await api<{ data: { id: string } }>('/api/v1/organizations/me/invitations', {
      method: 'POST',
      token: ownerToken,
      body: { name: 'B', email, roleType: 'editor' },
    });
    return created.body.data.id;
  }

  it('新しいリンクを送り直し、前のリンクは使えなくなる', async () => {
    const invitationId = await invite();
    const firstUrl = sent.at(-1)!.acceptUrl;

    const res = await api<{ data: { expiresAt: string } }>(
      `/api/v1/organizations/me/invitations/${invitationId}/resend`,
      { method: 'POST', token: ownerToken },
    );
    expect(res.status).toBe(200);

    const secondUrl = sent.at(-1)!.acceptUrl;
    expect(sent).toHaveLength(2);
    expect(secondUrl).not.toBe(firstUrl);

    // 新しいリンクは通り、古いリンクは 404 になる
    const newToken = secondUrl.split('/invitations/')[1]!;
    const oldToken = firstUrl.split('/invitations/')[1]!;
    expect((await api(`/api/v1/invitations/${newToken}`)).status).toBe(200);
    expect((await api(`/api/v1/invitations/${oldToken}`)).status).toBe(404);
  });

  it('枠を余計に消費しない (招待は 1 件のまま)', async () => {
    const invitationId = await invite();
    await api(`/api/v1/organizations/me/invitations/${invitationId}/resend`, {
      method: 'POST',
      token: ownerToken,
    });

    const members = await api<MembersBody>('/api/v1/organizations/me/members', {
      token: ownerToken,
    });
    expect(members.body.data.filter((m) => m.status === 'invited')).toHaveLength(1);
  });

  it('取り消し済みの招待は再送できない', async () => {
    const invitationId = await invite();
    await api(`/api/v1/organizations/me/invitations/${invitationId}`, {
      method: 'DELETE',
      token: ownerToken,
    });

    const res = await api<{ error: { code: string } }>(
      `/api/v1/organizations/me/invitations/${invitationId}/resend`,
      { method: 'POST', token: ownerToken },
    );
    expect(res.status).toBe(404);
  });

  it('他人 (課金権限の無い会員) は再送できない', async () => {
    const invitationId = await invite();
    const other = await createUser();
    const otherToken = await signTestJwt({ authUserId: other.authUserId, email: other.email });

    const res = await api(
      `/api/v1/organizations/me/invitations/${invitationId}/resend`,
      { method: 'POST', token: otherToken },
    );
    expect([403, 404]).toContain(res.status);
  });
});

describe('PATCH /organizations/me/members/:userId — 権限の変更 (#160)', () => {
  /** 組織に属する編集者を 1 名用意し、プロジェクトにも参加させる。 */
  async function seedEditor(projectCount = 1) {
    const user = await createUser({ withOrganization: false });
    await prisma.organizationMember.create({
      data: { organizationId, userId: user.id, orgRole: 'member', defaultProjectRole: 'editor' },
    });
    const projects = [];
    for (let i = 0; i < projectCount; i += 1) {
      const { project } = await createProjectWithAdmin({ user: owner, name: `P${i}` });
      await createMember({
        projectId: project.id,
        userId: user.id,
        email: user.email,
        roleType: 'editor',
      });
      projects.push(project);
    }
    return { user, projects };
  }

  it('参加中の全プロジェクトへ反映される', async () => {
    const { user, projects } = await seedEditor(2);

    const res = await api<{ data: { defaultProjectRole: string; affectedProjectIds: string[] } }>(
      `/api/v1/organizations/me/members/${user.id}`,
      { method: 'PATCH', token: ownerToken, body: { defaultProjectRole: 'admin' } },
    );

    expect(res.status).toBe(200);
    expect(res.body.data.defaultProjectRole).toBe('admin');
    expect(res.body.data.affectedProjectIds).toHaveLength(2);

    for (const p of projects) {
      const m = await prisma.projectMember.findFirstOrThrow({
        where: { projectId: p.id, userId: user.id },
      });
      expect(m.roleType).toBe('admin');
    }
    const orgMember = await prisma.organizationMember.findFirstOrThrow({
      where: { organizationId, userId: user.id },
    });
    expect(orgMember.defaultProjectRole).toBe('admin');
  });

  it('閲覧者へ落とすと座席が解放される', async () => {
    const { user } = await seedEditor(1);

    const before = await api<{
      data: { entitlement: { usage: { seatCount: number; viewerCount: number } } };
    }>('/api/v1/billing/subscription', { token: ownerToken });
    expect(before.body.data.entitlement.usage).toMatchObject({ seatCount: 2, viewerCount: 0 });

    await api(`/api/v1/organizations/me/members/${user.id}`, {
      method: 'PATCH',
      token: ownerToken,
      body: { defaultProjectRole: 'viewer' },
    });

    const after = await api<{
      data: { entitlement: { usage: { seatCount: number; viewerCount: number } } };
    }>('/api/v1/billing/subscription', { token: ownerToken });
    expect(after.body.data.entitlement.usage).toMatchObject({ seatCount: 1, viewerCount: 1 });
  });

  it('座席が満席なら閲覧者からの昇格を 409 で止める (抜け道を塞ぐ)', async () => {
    // Personal は座席 1 (オーナーで満席)、閲覧者は 5 まで
    await setBillingSubscription({ organizationId, planCode: 'personal', status: 'active' });
    const viewer = await createUser({ withOrganization: false });
    await prisma.organizationMember.create({
      data: { organizationId, userId: viewer.id, orgRole: 'member', defaultProjectRole: 'viewer' },
    });

    const res = await api<{ error: { code: string } }>(
      `/api/v1/organizations/me/members/${viewer.id}`,
      { method: 'PATCH', token: ownerToken, body: { defaultProjectRole: 'editor' } },
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEAT_LIMIT_REACHED');
  });

  it('オーナーを管理者以外にはできない', async () => {
    const res = await api<{ error: { code: string } }>(
      `/api/v1/organizations/me/members/${owner.id}`,
      { method: 'PATCH', token: ownerToken, body: { defaultProjectRole: 'editor' } },
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANNOT_CHANGE_OWNER');
  });

  it('プロジェクトの管理者が 0 名になる降格は 409 LAST_ADMIN', async () => {
    // 作成者ではない管理者だけがいるプロジェクトを作る
    const admin = await createUser({ withOrganization: false });
    await prisma.organizationMember.create({
      data: { organizationId, userId: admin.id, orgRole: 'member', defaultProjectRole: 'admin' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId,
        name: '管理者ひとり',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        createdBy: admin.id,
      },
    });
    await createMember({
      projectId: project.id,
      userId: admin.id,
      email: admin.email,
      roleType: 'admin',
    });

    const res = await api<{ error: { code: string } }>(
      `/api/v1/organizations/me/members/${admin.id}`,
      { method: 'PATCH', token: ownerToken, body: { defaultProjectRole: 'viewer' } },
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });
});

describe('GET /organizations/me/members/:userId/projects — 参加PJ ドロワー', () => {
  it('参加プロジェクトとボール保持数を返す', async () => {
    const { project, member: ownerMember } = await createProjectWithAdmin({ user: owner });
    const item = await prisma.projectItem.create({
      data: { projectId: project.id, name: 'トップページ', sortOrder: 0 },
    });
    // オーナーが実施者の予定を 2 件 (= ボール保持 2 件)
    for (let i = 0; i < 2; i += 1) {
      await prisma.plan.create({
        data: {
          itemId: item.id,
          title: `予定${i}`,
          category: 'design',
          scheduledDate: new Date('2026-06-01'),
          executorMemberId: ownerMember.id,
        },
      });
    }

    const res = await api<{
      data: Array<{ projectId: string; projectName: string; ballHolderCount: number }>;
    }>(`/api/v1/organizations/me/members/${owner.id}/projects`, { token: ownerToken });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      projectId: project.id,
      projectName: project.name,
      ballHolderCount: 2,
    });
  });

  it('参加していなければ空配列', async () => {
    const other = await createUser({ withOrganization: false });
    await prisma.organizationMember.create({
      data: { organizationId, userId: other.id, orgRole: 'member' },
    });

    const res = await api<{ data: unknown[] }>(
      `/api/v1/organizations/me/members/${other.id}/projects`,
      { token: ownerToken },
    );

    expect(res.body.data).toEqual([]);
  });
});
