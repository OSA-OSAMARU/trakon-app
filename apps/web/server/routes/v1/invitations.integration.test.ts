import { describe, expect, it } from 'vitest';

import { prisma } from '@trakon/db';

import { api } from '../../test/request.js';
import {
  createMember,
  createUser,
  setupProjectWithDirector,
} from '../../test/factories.js';
import { signTestJwt } from '../../test/auth.js';
import {
  defaultInvitationExpiresAt,
  generateInvitationToken,
} from '../../lib/tokens.js';

// =============================================================================
// invitations ルートの統合テスト (実 DB + ミドルウェアチェーン)
// マウント先: /api/v1/invitations/:token
//  - GET /:token        : 未認証可。トークン検証
//  - POST /:token/accept: JWT 必須。受諾
// 正常系: 検証 / 受諾、異常系: 期限切れ・失効・受諾済の 404 集約 / 401 / 業務エラー
// =============================================================================

/**
 * 招待行を直接投入し、生トークンを返すヘルパー。
 * invitedMember は呼び出し側で用意した仮メンバーを使う。
 */
async function seedInvitation(args: {
  projectId: string;
  invitedMemberId: string;
  email: string;
  organizationId?: string;
  roleType?: 'admin' | 'editor' | 'viewer';
  expiresAt?: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
}): Promise<{ rawToken: string }> {
  const { raw, hash } = generateInvitationToken();
  // 招待は座席カウントの単位として組織に紐づく (§7.3.2)
  const organizationId =
    args.organizationId ??
    (await prisma.project.findUniqueOrThrow({ where: { id: args.projectId } })).organizationId;
  await prisma.invitation.create({
    data: {
      projectId: args.projectId,
      invitedMemberId: args.invitedMemberId,
      email: args.email,
      organizationId,
      roleType: args.roleType ?? 'editor',
      tokenHash: hash,
      expiresAt: args.expiresAt ?? defaultInvitationExpiresAt(),
      acceptedAt: args.acceptedAt ?? null,
      revokedAt: args.revokedAt ?? null,
    },
  });
  return { rawToken: raw };
}

describe('invitations routes (integration)', () => {
  describe('正常系', () => {
    it('GET /:token は未認証でも有効な招待のプロジェクト概要を返す', async () => {
      const { project } = await setupProjectWithDirector();
      const member = await createMember({
        projectId: project.id,
        userId: null,
        email: 'invitee@example.test',
        memberType: 'client',
      });
      const { rawToken } = await seedInvitation({
        projectId: project.id,
        invitedMemberId: member.id,
        email: 'invitee@example.test',
      });

      const res = await api<{
        data: {
          project: { id: string };
          invitedMember: { email: string; memberType: string };
        };
      }>(`/api/v1/invitations/${rawToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.project.id).toBe(project.id);
      expect(res.body.data.invitedMember.email).toBe('invitee@example.test');
      expect(res.body.data.invitedMember.memberType).toBe('client');
    });

    it('POST /:token/accept は招待先メールのユーザーが受諾でき 201 を返す', async () => {
      const { project } = await setupProjectWithDirector();
      const member = await createMember({
        projectId: project.id,
        userId: null,
        email: 'invitee@example.test',
        memberType: 'production',
      });
      const { rawToken } = await seedInvitation({
        projectId: project.id,
        invitedMemberId: member.id,
        email: 'invitee@example.test',
      });
      // 招待先と同一メールのログインユーザー
      const invitee = await createUser({ email: 'invitee@example.test' });
      const token = await signTestJwt({
        authUserId: invitee.authUserId,
        email: invitee.email,
      });

      const res = await api<{
        data: { project: { id: string }; member: { id: string } };
      }>(`/api/v1/invitations/${rawToken}/accept`, { method: 'POST', token });

      expect(res.status).toBe(201);
      expect(res.body.data.project.id).toBe(project.id);
      expect(res.body.data.member.id).toBe(member.id);

      // 受諾後は member.userId が埋まり、invitation.acceptedAt が立つ
      const updated = await prisma.projectMember.findUnique({
        where: { id: member.id },
        select: { userId: true },
      });
      expect(updated!.userId).toBe(invitee.id);
    });
  });

  describe('異常系', () => {
    it('存在しないトークンの検証は 404 INVITATION_NOT_FOUND_OR_EXPIRED', async () => {
      // 生成しただけで DB には未投入 → 見つからない
      const { raw } = generateInvitationToken();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/invitations/${raw}`,
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('INVITATION_NOT_FOUND_OR_EXPIRED');
    });

    it('期限切れの招待検証は 404 に集約される', async () => {
      const { project } = await setupProjectWithDirector();
      const member = await createMember({
        projectId: project.id,
        userId: null,
        email: 'expired@example.test',
        memberType: 'client',
      });
      const { rawToken } = await seedInvitation({
        projectId: project.id,
        invitedMemberId: member.id,
        email: 'expired@example.test',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/invitations/${rawToken}`,
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('INVITATION_NOT_FOUND_OR_EXPIRED');
    });

    it('失効済みの招待検証は 404 に集約される', async () => {
      const { project } = await setupProjectWithDirector();
      const member = await createMember({
        projectId: project.id,
        userId: null,
        email: 'revoked@example.test',
        memberType: 'client',
      });
      const { rawToken } = await seedInvitation({
        projectId: project.id,
        invitedMemberId: member.id,
        email: 'revoked@example.test',
        revokedAt: new Date(),
      });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/invitations/${rawToken}`,
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('INVITATION_NOT_FOUND_OR_EXPIRED');
    });

    it('受諾には認証が必要 (401 AUTH_MISSING)', async () => {
      const { project } = await setupProjectWithDirector();
      const member = await createMember({
        projectId: project.id,
        userId: null,
        email: 'noauth@example.test',
        memberType: 'client',
      });
      const { rawToken } = await seedInvitation({
        projectId: project.id,
        invitedMemberId: member.id,
        email: 'noauth@example.test',
      });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/invitations/${rawToken}/accept`,
        { method: 'POST' },
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_MISSING');
    });

    it('招待先と異なるメールのユーザーによる受諾は 403 INVITATION_EMAIL_MISMATCH', async () => {
      const { project } = await setupProjectWithDirector();
      const member = await createMember({
        projectId: project.id,
        userId: null,
        email: 'invited@example.test',
        memberType: 'client',
      });
      const { rawToken } = await seedInvitation({
        projectId: project.id,
        invitedMemberId: member.id,
        email: 'invited@example.test',
      });
      // 別メールのログインユーザー
      const other = await createUser({ email: 'someone-else@example.test' });
      const token = await signTestJwt({
        authUserId: other.authUserId,
        email: other.email,
      });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/invitations/${rawToken}/accept`,
        { method: 'POST', token },
      );
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');
    });

    it('既に別の member 行で参加済みのユーザーの受諾は 409 ALREADY_MEMBER', async () => {
      const { project } = await setupProjectWithDirector();
      const invitee = await createUser({ email: 'already@example.test' });
      // 既存の参加済みメンバー (同一ユーザー・別 member 行)。
      // ALREADY_MEMBER 判定は userId で行うため、email は招待先と衝突しないよう別値にする
      // (project_id × email のユニーク制約を避ける)。
      await createMember({
        projectId: project.id,
        userId: invitee.id,
        email: 'already-existing@example.test',
        memberType: 'production',
      });
      // 招待先の別 member 行 (userId は未設定)。email は受諾ユーザーと一致させる必要がある
      // (メール不一致だと 403 が先に返るため)。
      const invitedMember = await createMember({
        projectId: project.id,
        userId: null,
        email: 'already@example.test',
        memberType: 'client',
      });
      const { rawToken } = await seedInvitation({
        projectId: project.id,
        invitedMemberId: invitedMember.id,
        email: 'already@example.test',
      });
      const token = await signTestJwt({
        authUserId: invitee.authUserId,
        email: invitee.email,
      });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/invitations/${rawToken}/accept`,
        { method: 'POST', token },
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_MEMBER');
    });
  });
});
