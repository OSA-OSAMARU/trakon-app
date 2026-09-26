import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// supabase は apiRequest の Authorization 注入で getSession を呼ぶためモックする。
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'u1' } } } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
    },
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { defaultBillingResponse, server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { OrgMembersPage } from './OrgMembersPage';
import type { OrgMember } from './api';

beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
  p.setPointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
});

const owner: OrgMember = {
  userId: 'u-owner',
  invitationId: null,
  status: 'active',
  name: '佐藤 航',
  organizationName: 'おさまるカンパニー',
  email: 'sato@example.jp',
  jobTitle: 'director',
  avatarUrl: null,
  orgRole: 'owner',
  defaultProjectRole: 'admin',
  projectCount: 4,
  joinedAt: '2026-01-01T00:00:00Z',
  expiresAt: null,
};

const editor: OrgMember = {
  ...owner,
  userId: 'u-editor',
  name: '横山 美咲',
  organizationName: '博報堂',
  email: 'yokoyama@example.jp',
  jobTitle: 'designer',
  orgRole: 'member',
  defaultProjectRole: 'editor',
  projectCount: 3,
};

const invited: OrgMember = {
  userId: null,
  invitationId: 'inv-1',
  status: 'invited',
  name: '石原 美咲',
  organizationName: null,
  email: 'ishihara@example.jp',
  jobTitle: null,
  avatarUrl: null,
  orgRole: null,
  defaultProjectRole: 'editor',
  projectCount: 0,
  joinedAt: null,
  expiresAt: '2026-02-01T00:00:00Z',
};

/** Team プラン (座席 5 / 閲覧者 20) の契約情報。 */
function teamBilling(over: Record<string, unknown> = {}) {
  return {
    ...defaultBillingResponse,
    subscription: { ...defaultBillingResponse.subscription, planCode: 'team', status: 'active' },
    entitlement: {
      ...defaultBillingResponse.entitlement,
      planCode: 'team',
      effectivePlanCode: 'team',
      limits: { seatLimit: 5, viewerLimit: 20, projectLimit: null },
      usage: { seatCount: 3, viewerCount: 0, projectCount: 4 },
      canInviteMember: true,
      canInviteViewer: true,
      invitableProjectRoles: ['admin', 'editor', 'viewer'],
    },
    ...over,
  };
}

/** Free プラン (座席 1 = オーナー本人で埋まる / 閲覧者 5) の契約情報 (#257)。 */
function freeBilling(over: Record<string, unknown> = {}) {
  return {
    ...defaultBillingResponse,
    entitlement: {
      ...defaultBillingResponse.entitlement,
      limits: { seatLimit: 1, viewerLimit: 5, projectLimit: 2 },
      usage: { seatCount: 1, viewerCount: 0, projectCount: 1 },
      canInviteMember: false,
      canInviteViewer: true,
      invitableProjectRoles: ['viewer'],
    },
    ...over,
  };
}

function stub(opts: { members?: OrgMember[]; billing?: unknown; orgRole?: string } = {}) {
  const billing = opts.billing ?? teamBilling(opts.orgRole ? { orgRole: opts.orgRole } : {});
  server.use(
    http.get('*/api/v1/billing/subscription', () => HttpResponse.json({ data: billing })),
    http.get('*/api/v1/organizations/me/members', () =>
      HttpResponse.json({ data: opts.members ?? [owner, editor, invited] }),
    ),
    http.get('*/api/v1/projects', () => HttpResponse.json({ data: [] })),
  );
}

function renderPage() {
  return renderWithProviders(<OrgMembersPage />, { route: '/settings/members' });
}

describe('OrgMembersPage', () => {
  it('プラン枠と一覧を描画する', async () => {
    stub();
    renderPage();

    expect(await screen.findByText('Team プラン')).toBeInTheDocument();
    expect(screen.getByText('3 / 5名 利用中')).toBeInTheDocument();

    expect(await screen.findByText('佐藤 航')).toBeInTheDocument();
    expect(screen.getByText('おさまるカンパニー')).toBeInTheDocument();
    expect(screen.getByText('sato@example.jp')).toBeInTheDocument();
    expect(screen.getByText('ディレクター')).toBeInTheDocument();
  });

  it('招待中の行は権限欄に「招待中」を出し、所属・職種は — にする', async () => {
    stub();
    renderPage();

    const row = (await screen.findByText('石原 美咲')).closest('tr')!;
    expect(within(row).getByText('招待中')).toBeInTheDocument();
    expect(within(row).getAllByText('—')).toHaveLength(2);
    // 招待中は権限セレクトを出さない
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('オーナーの権限は変更できない', async () => {
    stub();
    renderPage();

    await screen.findByText('佐藤 航');
    expect(screen.getByRole('combobox', { name: '佐藤 航 の権限' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '横山 美咲 の権限' })).toBeEnabled();
  });

  it('氏名・メールで絞り込める', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    renderPage();

    await screen.findByText('佐藤 航');
    await user.type(screen.getByLabelText('氏名・メールで検索'), 'yokoyama');

    expect(screen.getByText('横山 美咲')).toBeInTheDocument();
    expect(screen.queryByText('佐藤 航')).not.toBeInTheDocument();
  });

  it('権限を変えると確認ダイアログが出て、確定で PATCH を送る', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    let patched: unknown = null;
    server.use(
      http.patch('*/api/v1/organizations/me/members/u-editor', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({
          data: { userId: 'u-editor', defaultProjectRole: 'admin', affectedProjectIds: [] },
        });
      }),
    );

    renderPage();
    await screen.findByText('横山 美咲');

    await user.click(screen.getByRole('combobox', { name: '横山 美咲 の権限' }));
    await user.click(await screen.findByRole('option', { name: '管理者' }));

    expect(await screen.findByText('権限を変更しますか？')).toBeInTheDocument();
    // 既定値の変更ではなく実際の権限変更であることを伝える
    expect(screen.getByText(/参加中の 3 件のプロジェクトすべてに反映されます。/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '権限を変更' }));

    await waitFor(() => expect(patched).toEqual({ defaultProjectRole: 'admin' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('権限を変更しました'));
  });

  it('権限変更が 409 ならエラートーストを出す (座席満席など)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    server.use(
      http.patch('*/api/v1/organizations/me/members/u-editor', () =>
        HttpResponse.json(
          { error: { code: 'SEAT_LIMIT_REACHED', message: '上限に達しています' } },
          { status: 409 },
        ),
      ),
    );

    renderPage();
    await screen.findByText('横山 美咲');
    await user.click(screen.getByRole('combobox', { name: '横山 美咲 の権限' }));
    await user.click(await screen.findByRole('option', { name: '管理者' }));
    await user.click(await screen.findByRole('button', { name: '権限を変更' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('上限に達しています'));
  });

  it('招待中の行は「招待を取り消す」で DELETE を送る', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    let deleted = false;
    server.use(
      http.delete('*/api/v1/organizations/me/invitations/inv-1', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderPage();
    await screen.findByText('石原 美咲');

    await user.click(screen.getByRole('button', { name: '石原 美咲 の操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '招待を取り消す' }));
    await user.click(await screen.findByRole('button', { name: '招待を取り消す' }));

    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('招待を取り消しました'));
  });

  /**
   * メニュー → 確認ダイアログ → 実行、のあとも画面を操作できること (#240)。
   *
   * Radix の既定ではメニューが開いている間 body の pointer-events が none になる。
   * 閉じ切る前にダイアログが重なると「元の値」として none を覚えてしまい、
   * ダイアログを閉じたあとも画面全体がクリックできないまま残る。
   */
  it('招待を取り消したあとも画面を操作できる (#240)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    let deleted = false;
    server.use(
      http.delete('*/api/v1/organizations/me/invitations/inv-1', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderPage();
    await screen.findByText('石原 美咲');

    await user.click(screen.getByRole('button', { name: '石原 美咲 の操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '招待を取り消す' }));
    await user.click(await screen.findByRole('button', { name: '招待を取り消す' }));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    // 画面全体が「触れない」状態で取り残されていないこと
    await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: 'none' }));
  });

  it('会員を削除すると DELETE /organizations/me/members/:id を送る', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    let deleted = false;
    server.use(
      http.delete('*/api/v1/organizations/me/members/u-editor', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderPage();
    await screen.findByText('横山 美咲');

    await user.click(screen.getByRole('button', { name: '横山 美咲 の操作' }));
    await user.click(await screen.findByRole('menuitem', { name: 'メンバーを削除' }));
    // 削除しても表示と履歴は残ることを伝える
    expect(
      await screen.findByText(/プロジェクト上の表示と履歴は残ります。/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('メンバーを削除しました'));
  });

  it('ドロワーからプロジェクトを外せる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    let removed: string | null = null;
    server.use(
      http.get('*/api/v1/organizations/me/members/u-editor/projects', () =>
        HttpResponse.json({
          data: [
            {
              projectId: 'p-1',
              projectName: '灯和食品｜ブランドサイト',
              memberId: 'pm-1',
              roleType: 'editor',
              ballHolderCount: 0,
            },
          ],
        }),
      ),
      http.delete('*/api/v1/projects/p-1/members/pm-1', () => {
        removed = 'pm-1';
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderPage();
    const row = (await screen.findByText('横山 美咲')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /3件/ }));

    await screen.findByText('灯和食品｜ブランドサイト');
    await user.click(screen.getByRole('button', { name: 'プロジェクトから外す' }));

    await waitFor(() => expect(removed).toBe('pm-1'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('プロジェクトから外しました'));
  });

  it('招待が 409 ならエラートーストを出す', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    server.use(
      http.post('*/api/v1/organizations/me/invitations', () =>
        HttpResponse.json(
          { error: { code: 'ALREADY_MEMBER', message: '既に会員です' } },
          { status: 409 },
        ),
      ),
    );

    renderPage();
    await screen.findByText('佐藤 航');
    await user.click(screen.getByRole('button', { name: 'メンバーを招待' }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/氏名/), '重複');
    await user.type(within(dialog).getByLabelText(/通知先メール/), 'sato@example.jp');
    await user.click(screen.getByRole('button', { name: '招待を送信' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('既に会員です'));
  });

  it('招待の必須項目が空なら送信しない', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    const post = vi.fn();
    server.use(
      http.post('*/api/v1/organizations/me/invitations', () => {
        post();
        return HttpResponse.json({ data: { id: 'x' } }, { status: 201 });
      }),
    );

    renderPage();
    await screen.findByText('佐藤 航');
    await user.click(screen.getByRole('button', { name: 'メンバーを招待' }));
    await user.click(await screen.findByRole('button', { name: '招待を送信' }));

    expect(await screen.findByText('氏名は必須')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('オーナーの行には削除の項目を出さず、理由を出す', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    renderPage();
    await screen.findByText('佐藤 航');

    await user.click(screen.getByRole('button', { name: '佐藤 航 の操作' }));
    expect(await screen.findByText('オーナーは削除できません')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'メンバーを削除' })).not.toBeInTheDocument();
  });

  // #230: 招待が届かなかったときに追いかける手段がこれしか無い
  it('招待中の行は「招待メールを再送」で resend POST を送る', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    let resent = false;
    server.use(
      http.post('*/api/v1/organizations/me/invitations/inv-1/resend', () => {
        resent = true;
        return HttpResponse.json({ data: { expiresAt: '2026-03-01T00:00:00Z' } });
      }),
    );

    renderPage();
    await screen.findByText('石原 美咲');

    await user.click(screen.getByRole('button', { name: '石原 美咲 の操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '招待メールを再送' }));

    await waitFor(() => expect(resent).toBe(true));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('ishihara@example.jp に招待メールを送り直しました'),
    );
  });

  it('再送に失敗したらエラートーストを出す', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    server.use(
      http.post('*/api/v1/organizations/me/invitations/inv-1/resend', () =>
        HttpResponse.json(
          { error: { code: 'MAIL_SEND_FAILED', message: 'メールを送信できませんでした' } },
          { status: 500 },
        ),
      ),
    );

    renderPage();
    await screen.findByText('石原 美咲');

    await user.click(screen.getByRole('button', { name: '石原 美咲 の操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '招待メールを再送' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('メールを送信できませんでした'),
    );
  });

  it('会員の行には再送を出さない (招待中ではないため)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    renderPage();
    await screen.findByText('横山 美咲');

    await user.click(screen.getByRole('button', { name: '横山 美咲 の操作' }));
    expect(await screen.findByRole('menuitem', { name: 'メンバーを削除' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '招待メールを再送' })).not.toBeInTheDocument();
  });

  it('参加PJ をクリックするとドロワーが開き、ボール保持数が出る', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    server.use(
      http.get('*/api/v1/organizations/me/members/u-editor/projects', () =>
        HttpResponse.json({
          data: [
            {
              projectId: 'p-1',
              projectName: '灯和食品｜ブランドサイト',
              memberId: 'pm-1',
              roleType: 'editor',
              ballHolderCount: 2,
            },
          ],
        }),
      ),
    );

    renderPage();
    const row = (await screen.findByText('横山 美咲')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /3件/ }));

    expect(await screen.findByText('参加プロジェクト')).toBeInTheDocument();
    expect(await screen.findByText('灯和食品｜ブランドサイト')).toBeInTheDocument();
    expect(screen.getByText('Ball Holder：2件')).toBeInTheDocument();
  });

  it('招待モーダルから POST を送る', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    let posted: Record<string, unknown> | null = null;
    server.use(
      http.post('*/api/v1/organizations/me/invitations', async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { id: 'inv-9' } }, { status: 201 });
      }),
    );

    renderPage();
    await screen.findByText('佐藤 航');
    await user.click(screen.getByRole('button', { name: 'メンバーを招待' }));

    // ダイアログ見出し (トリガーボタンと同名なので role で絞る)
    expect(await screen.findByRole('heading', { name: 'メンバーを招待' })).toBeInTheDocument();
    // 残り枠を出す (座席 5 - 使用 3 = 2)
    expect(screen.getByText(/現在の空きは2名です。/)).toBeInTheDocument();

    // 検索欄のラベルも「氏名・メールで検索」なので、ダイアログ内に絞って取る
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/氏名/), '田中 太郎');
    await user.type(within(dialog).getByLabelText(/通知先メール/), 'tanaka@example.jp');
    await user.click(screen.getByRole('button', { name: '招待を送信' }));

    await waitFor(() => expect(posted).toMatchObject({
      name: '田中 太郎',
      email: 'tanaka@example.jp',
      roleType: 'editor',
    }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('招待を送信しました'));
  });

  it('招待の権限を閲覧者にすると閲覧者枠の説明に切り替わる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub();
    renderPage();
    await screen.findByText('佐藤 航');
    await user.click(screen.getByRole('button', { name: 'メンバーを招待' }));

    await user.click(await screen.findByRole('combobox', { name: '権限' }));
    await user.click(await screen.findByRole('option', { name: '閲覧者' }));

    expect(await screen.findByText('招待すると閲覧者枠を1名分使用します')).toBeInTheDocument();
    expect(screen.getByText(/閲覧者は管理者・編集者の枠を消費しません。/)).toBeInTheDocument();
    // 閲覧者は 20 枠のうち 0 使用
    expect(screen.getByText(/現在の空きは20名です。/)).toBeInTheDocument();
  });

  it('Free では閲覧者としてしか招待できない (#257)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub({ billing: freeBilling() });
    renderPage();
    await screen.findByText('佐藤 航');
    await user.click(screen.getByRole('button', { name: 'メンバーを招待' }));

    // 既定の editor は選べないので、選べる閲覧者へ寄せる
    expect(await screen.findByText('現在のプランでは閲覧者としてのみ招待できます。')).toBeInTheDocument();
    expect(await screen.findByText('招待すると閲覧者枠を1名分使用します')).toBeInTheDocument();
    expect(screen.getByText(/現在の空きは5名です。/)).toBeInTheDocument();

    await user.click(await screen.findByRole('combobox', { name: '権限' }));
    expect(await screen.findByRole('option', { name: '編集者' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: '管理者' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: '閲覧者' })).not.toHaveAttribute('aria-disabled');
  });

  it('Free では閲覧者を編集者へ昇格させる選択肢を選べない (#257)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stub({
      billing: freeBilling(),
      members: [owner, { ...editor, defaultProjectRole: 'viewer' as const }],
    });
    renderPage();

    await user.click(await screen.findByRole('combobox', { name: '横山 美咲 の権限' }));

    expect(await screen.findByRole('option', { name: '編集者' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // 今のロール (閲覧者) は選択肢として残す
    expect(screen.getByRole('option', { name: '閲覧者' })).not.toHaveAttribute('aria-disabled');
  });

  it('一般の会員には管理できない旨を出し、一覧を取りに行かない', async () => {
    let fetched = false;
    server.use(
      http.get('*/api/v1/billing/subscription', () =>
        HttpResponse.json({ data: teamBilling({ orgRole: 'member' }) }),
      ),
      http.get('*/api/v1/organizations/me/members', () => {
        fetched = true;
        return HttpResponse.json({ data: [] });
      }),
    );

    renderPage();

    expect(
      await screen.findByText(/メンバー管理は組織のオーナーまたは管理者のみが利用できます。/),
    ).toBeInTheDocument();
    expect(fetched).toBe(false);
  });
});
