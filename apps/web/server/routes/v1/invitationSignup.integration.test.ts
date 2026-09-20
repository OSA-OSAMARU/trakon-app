import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@trakon/db';
import { uuidv7 } from 'uuidv7';

import { api } from '../../test/request.js';
import {
  createMember,
  createUser,
  primaryOrganizationId,
  setBillingSubscription,
} from '../../test/factories.js';
import { defaultInvitationExpiresAt, generateInvitationToken } from '../../lib/tokens.js';

// =============================================================================
// POST /invitations/:token/signup — 招待からの直接登録 (#233)
//
// 招待メールが届いている時点でアドレスの所有は確かめられているので、確認メールを
// もう 1 通送らずにアカウントを作り、そのまま組織に参加させる導線。
//
// Supabase Auth だけ差し替え、DB は実物を通す。確かめたいのは
// 「作る前に落ちる条件をすべて見ているか」「失敗したら auth 側を残さないか」で、
// どちらも DB の状態と admin 呼び出しの有無で判定できる。
// =============================================================================

const admin = vi.hoisted(() => ({
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  deleteUser: vi.fn(),
}));
const findAuthUserByEmail = vi.hoisted(() => vi.fn());

vi.mock('../../lib/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({ auth: { admin } }),
  findAuthUserByEmail: (...a: unknown[]) => findAuthUserByEmail(...a),
}));

const BODY = { fullName: '招待 太郎', displayName: 'たろ', password: 'abcd1234!' };
const INVITEE_EMAIL = 'invitee@example.test';

/** Supabase が新しい auth ユーザーを作った、という応答にする */
function stubCreateUser(authUserId = uuidv7()) {
  admin.createUser.mockResolvedValue({ data: { user: { id: authUserId } }, error: null });
  return authUserId;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubCreateUser();
  admin.updateUserById.mockResolvedValue({ data: { user: null }, error: null });
  admin.deleteUser.mockResolvedValue({ data: null, error: null });
  findAuthUserByEmail.mockResolvedValue(null);
});

type Options = {
  planCode?: 'free' | 'personal' | 'team';
  roleType?: 'admin' | 'editor' | 'viewer';
  expiresAt?: Date;
  revokedAt?: Date | null;
  /** 指定すると、その組織のプロジェクトに未紐付けの参加者行を作る */
  withProjectMember?: boolean;
};

/**
 * 招待できるプランの組織と、組織単位の招待 (メンバー管理から発行されるもの) を
 * 1 件用意する。生トークンはここでしか手に入らない (DB にはハッシュしか残らない)。
 */
async function setup(opts: Options = {}) {
  const owner = await createUser();
  const organizationId = await primaryOrganizationId(owner.id);
  await setBillingSubscription({
    organizationId,
    planCode: opts.planCode ?? 'team',
    status: 'active',
  });

  let projectId: string | null = null;
  let memberId: string | null = null;
  if (opts.withProjectMember) {
    const project = await prisma.project.create({
      data: {
        organizationId,
        name: 'テスト案件',
        createdBy: owner.id,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-03-31'),
      },
    });
    projectId = project.id;
    const member = await createMember({
      projectId: project.id,
      userId: null,
      email: INVITEE_EMAIL,
      memberType: 'production',
    });
    memberId = member.id;
  }

  const { raw, hash } = generateInvitationToken();
  const invitation = await prisma.invitation.create({
    data: {
      organizationId,
      invitedByUserId: owner.id,
      email: INVITEE_EMAIL,
      invitedName: '招待 太郎',
      organizationName: '株式会社サンプル',
      roleType: opts.roleType ?? 'editor',
      tokenHash: hash,
      expiresAt: opts.expiresAt ?? defaultInvitationExpiresAt(),
      revokedAt: opts.revokedAt ?? null,
    },
  });

  return { owner, organizationId, projectId, memberId, invitationId: invitation.id, rawToken: raw };
}

function signup(rawToken: string, body: Record<string, unknown> = BODY) {
  return api<{ data: { email: string; accepted: { scope: string; members: unknown[] } } }>(
    `/api/v1/invitations/${rawToken}/signup`,
    { method: 'POST', body },
  );
}

describe('POST /invitations/:token/signup — 招待からの直接登録 (#233)', () => {
  it('確認メールを挟まずにアカウントを作り、組織に参加させる', async () => {
    const { organizationId, rawToken, invitationId } = await setup();

    const res = await signup(rawToken);
    expect(res.status).toBe(201);
    // メールは招待が持っているものが使われる (body では受け取らない)
    expect(res.body.data.email).toBe(INVITEE_EMAIL);
    expect(res.body.data.accepted.scope).toBe('org');

    // 招待メールで所有確認済みなので、確認を待たせない
    expect(admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: INVITEE_EMAIL, email_confirm: true }),
    );

    const created = await prisma.user.findFirstOrThrow({ where: { email: INVITEE_EMAIL } });
    expect(created.fullName).toBe('招待 太郎');
    expect(created.primaryAuthMethod).toBe('password');
    // 招待に入っていた所属名を引き継ぐ (#156)
    expect(created.organizationName).toBe('株式会社サンプル');

    // 招待元の組織に会員として入る + 自分の個人組織も持つ (§7.3.1)
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: created.id, deletedAt: null },
    });
    expect(memberships.map((m) => m.organizationId)).toContain(organizationId);
    expect(memberships).toHaveLength(2);

    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(invitation.acceptedAt).not.toBeNull();
  });

  it('招待時に選ばれていたプロジェクトの参加者行に紐づく', async () => {
    const { rawToken, memberId } = await setup({ withProjectMember: true });

    const res = await signup(rawToken);
    expect(res.status).toBe(201);
    expect(res.body.data.accepted.members).toHaveLength(1);

    const member = await prisma.projectMember.findUniqueOrThrow({ where: { id: memberId! } });
    expect(member.userId).not.toBeNull();
    expect(member.roleType).toBe('editor');
  });

  it('既にアカウントがあるメールは作らせず、ログインへ誘導する', async () => {
    const { rawToken } = await setup();
    await createUser({ email: INVITEE_EMAIL });

    const res = await api<{ error: { code: string } }>(
      `/api/v1/invitations/${rawToken}/signup`,
      { method: 'POST', body: BODY },
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('失効した招待は 404 で、アカウントを作らない', async () => {
    const { rawToken } = await setup({ revokedAt: new Date() });

    const res = await signup(rawToken);
    expect(res.status).toBe(404);
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('期限切れの招待は 404 で、アカウントを作らない', async () => {
    const { rawToken } = await setup({ expiresAt: new Date('2020-01-01') });

    const res = await signup(rawToken);
    expect(res.status).toBe(404);
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('座席が満席なら作る前に断る (宙に浮いたアカウントを残さない)', async () => {
    // Free は会員 1 名が上限。オーナーで埋まっているので 2 人目は入れない
    const { rawToken } = await setup({ planCode: 'free' });

    const res = await api<{ error: { code: string } }>(
      `/api/v1/invitations/${rawToken}/signup`,
      { method: 'POST', body: BODY },
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEAT_LIMIT_REACHED');
    expect(admin.createUser).not.toHaveBeenCalled();
    expect(await prisma.user.findFirst({ where: { email: INVITEE_EMAIL } })).toBeNull();
  });

  it('auth 側にだけ行が残っている人は拾ってパスワードを設定する', async () => {
    // マジックリンクだけ踏んでプロフィール登録まで進まなかった場合。
    // ここで行き止まりにすると登録もログインもできなくなる。
    const { rawToken } = await setup();
    const strandedAuthUserId = uuidv7();
    admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'A user with this email address has already been registered' },
    });
    findAuthUserByEmail.mockResolvedValue({ id: strandedAuthUserId, email: INVITEE_EMAIL });

    const res = await signup(rawToken);
    expect(res.status).toBe(201);
    expect(admin.updateUserById).toHaveBeenCalledWith(
      strandedAuthUserId,
      expect.objectContaining({ password: BODY.password, email_confirm: true }),
    );

    const created = await prisma.user.findFirstOrThrow({ where: { email: INVITEE_EMAIL } });
    expect(created.authUserId).toBe(strandedAuthUserId);
  });

  it('DB 側で失敗したら、こちらが作った auth ユーザーを消して戻す', async () => {
    const { rawToken } = await setup();
    // 同じ auth_user_id の users 行を先に作っておくと、プロフィール作成が
    // 一意制約で落ちる。ロールバック経路を通すための仕込み。
    const collidingAuthUserId = uuidv7();
    await createUser({ authUserId: collidingAuthUserId });
    stubCreateUser(collidingAuthUserId);

    const res = await signup(rawToken);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(admin.deleteUser).toHaveBeenCalledWith(collidingAuthUserId);
    expect(await prisma.user.findFirst({ where: { email: INVITEE_EMAIL } })).toBeNull();
  });

  it('元から居た auth ユーザーは失敗しても消さない', async () => {
    const { rawToken } = await setup();
    const strandedAuthUserId = uuidv7();
    await createUser({ authUserId: strandedAuthUserId });
    admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'already registered' },
    });
    findAuthUserByEmail.mockResolvedValue({ id: strandedAuthUserId, email: INVITEE_EMAIL });

    const res = await signup(rawToken);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('パスワードが要件を満たさなければ弾き、アカウントを作らない', async () => {
    const { rawToken } = await setup();

    const res = await signup(rawToken, { ...BODY, password: 'short' });
    // Zod の検証失敗は 422 に集約される (middleware/error.ts)
    expect(res.status).toBe(422);
    expect(admin.createUser).not.toHaveBeenCalled();
  });
});
