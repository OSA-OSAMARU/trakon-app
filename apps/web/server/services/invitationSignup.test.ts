import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashToken } from '../lib/tokens.js';

// =============================================================================
// signupWithInvitation の単体テスト (#233)
//
// 実 DB を通す経路は invitationSignup.integration.test.ts が見る。ここが担うのは
// **Supabase 側が失敗したときの分岐**。実 DB のテストでは作り分けにくく、
// かつ間違えると「認証だけ作られてプロフィールが無い人」が残る箇所なので、
// 失敗の形ごとに固定しておく。
// =============================================================================

const prismaMock = vi.hoisted(() => ({
  invitation: { findFirst: vi.fn() },
  user: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  organization: { create: vi.fn() },
  organizationMember: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

const admin = vi.hoisted(() => ({
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  deleteUser: vi.fn(),
}));
const findAuthUserByEmail = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({ auth: { admin } }),
  findAuthUserByEmail: (...a: unknown[]) => findAuthUserByEmail(...a),
}));

const getEntitlementMock = vi.hoisted(() => vi.fn());
vi.mock('./billing/entitlement.js', () => ({
  getEntitlement: (...a: unknown[]) => getEntitlementMock(...a),
}));

vi.mock('./organizations.js', () => ({
  defaultOrganizationName: (name: string) => `${name} の組織`,
  ensureOrganizationMember: vi.fn(),
}));

const { signupWithInvitation } = await import('./invitations.js');

const RAW_TOKEN = 'raw-token-signup';
const BODY = { fullName: '招待 太郎', displayName: 'たろ', password: 'abcd1234!' };

function seedInvitation(over: Record<string, unknown> = {}) {
  prismaMock.invitation.findFirst.mockResolvedValue({
    id: 'inv-1',
    tokenHash: hashToken(RAW_TOKEN),
    email: 'invitee@example.com',
    organizationId: 'org-1',
    organizationName: null,
    invitedName: '招待 太郎',
    jobTitle: null,
    roleType: 'editor',
    projectId: null,
    invitedMemberId: null,
    expiresAt: new Date(Date.now() + 60_000),
    project: null,
    organization: { name: 'テスト組織' },
    invitedMember: null,
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seedInvitation();
  prismaMock.user.findFirst.mockResolvedValue(null);
  // 受諾の中で読まれる自分の users 行
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'u-new',
    email: 'invitee@example.com',
    organizationName: null,
    jobTitle: null,
  });
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => Promise<unknown>)(prismaMock);
  });
  getEntitlementMock.mockResolvedValue({
    limits: { seatLimit: 5, viewerLimit: 20, projectLimit: null },
    usage: { seatCount: 2, viewerCount: 0, projectCount: 0 },
  });
  admin.createUser.mockResolvedValue({ data: { user: { id: 'auth-new' } }, error: null });
  admin.updateUserById.mockResolvedValue({ data: { user: null }, error: null });
  admin.deleteUser.mockResolvedValue({ data: null, error: null });
  findAuthUserByEmail.mockResolvedValue(null);
});

/** 受諾の中身までは踏み込まず、プロフィール作成まで通ったかを見る */
function transactionCalls() {
  return prismaMock.$transaction.mock.calls.filter(([arg]) => Array.isArray(arg));
}

describe('signupWithInvitation — 作る前に落ちる条件', () => {
  it('既にアカウントがあるメールは auth ユーザーを作らない', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ primaryAuthMethod: 'google' });

    await expect(signupWithInvitation({ rawToken: RAW_TOKEN, ...BODY })).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_REGISTERED',
      status: 409,
    });
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('座席が満席なら auth ユーザーを作らない', async () => {
    getEntitlementMock.mockResolvedValue({
      limits: { seatLimit: 1, viewerLimit: 20, projectLimit: null },
      usage: { seatCount: 2, viewerCount: 0, projectCount: 0 },
    });

    await expect(signupWithInvitation({ rawToken: RAW_TOKEN, ...BODY })).rejects.toMatchObject({
      code: 'SEAT_LIMIT_REACHED',
      status: 409,
    });
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('無効なトークンは auth ユーザーを作らない', async () => {
    prismaMock.invitation.findFirst.mockResolvedValue(null);

    await expect(signupWithInvitation({ rawToken: RAW_TOKEN, ...BODY })).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND_OR_EXPIRED',
      status: 404,
    });
    expect(admin.createUser).not.toHaveBeenCalled();
  });
});

describe('signupWithInvitation — Supabase 側の失敗', () => {
  it('作成に失敗し、既存の auth ユーザーも見つからなければ 500', async () => {
    admin.createUser.mockResolvedValue({ data: { user: null }, error: { message: 'boom' } });
    findAuthUserByEmail.mockResolvedValue(null);

    await expect(signupWithInvitation({ rawToken: RAW_TOKEN, ...BODY })).rejects.toMatchObject({
      code: 'SUPABASE_CREATE_FAILED',
      status: 500,
    });
    expect(transactionCalls()).toHaveLength(0);
  });

  it('既存の auth ユーザーへのパスワード設定に失敗したら 500', async () => {
    admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'already registered' },
    });
    findAuthUserByEmail.mockResolvedValue({ id: 'auth-stranded', email: 'invitee@example.com' });
    admin.updateUserById.mockResolvedValue({ data: null, error: { message: 'nope' } });

    await expect(signupWithInvitation({ rawToken: RAW_TOKEN, ...BODY })).rejects.toMatchObject({
      code: 'SUPABASE_UPDATE_FAILED',
      status: 500,
    });
    expect(transactionCalls()).toHaveLength(0);
  });

  it('エラーは無いのにユーザーが返らない応答も失敗として扱う', async () => {
    admin.createUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(signupWithInvitation({ rawToken: RAW_TOKEN, ...BODY })).rejects.toMatchObject({
      code: 'SUPABASE_CREATE_FAILED',
      status: 500,
    });
    expect(transactionCalls()).toHaveLength(0);
  });
});

describe('signupWithInvitation — 作ったあとの巻き戻し', () => {
  it('プロフィール作成で落ちたら、こちらが作った auth ユーザーを消す', async () => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) throw new Error('db down');
      return (arg as (tx: unknown) => Promise<unknown>)(prismaMock);
    });

    await expect(signupWithInvitation({ rawToken: RAW_TOKEN, ...BODY })).rejects.toThrow(
      'db down',
    );
    expect(admin.deleteUser).toHaveBeenCalledWith('auth-new');
  });

  it('元から居た auth ユーザーは消さない', async () => {
    admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'already registered' },
    });
    findAuthUserByEmail.mockResolvedValue({ id: 'auth-stranded', email: 'invitee@example.com' });
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) throw new Error('db down');
      return (arg as (tx: unknown) => Promise<unknown>)(prismaMock);
    });

    await expect(signupWithInvitation({ rawToken: RAW_TOKEN, ...BODY })).rejects.toThrow(
      'db down',
    );
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('巻き戻しに失敗しても、元の失敗をそのまま返す', async () => {
    admin.deleteUser.mockResolvedValue({ data: null, error: { message: 'delete failed' } });
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) throw new Error('db down');
      return (arg as (tx: unknown) => Promise<unknown>)(prismaMock);
    });

    // 消せなかったことで原因が「delete failed」にすり替わらないこと
    await expect(signupWithInvitation({ rawToken: RAW_TOKEN, ...BODY })).rejects.toThrow(
      'db down',
    );
  });
});
