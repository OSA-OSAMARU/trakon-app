import { beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { MembersPage } from './MembersPage';
import type { ProjectMember } from './membersApi';

// supabase はモックして getSession を固定 (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }),
    },
  },
}));

// 削除できない理由はトーストにしか出ない。サーバーの文面がそのまま届くかを見る。
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

// Radix UI が jsdom に無い API を呼ぶため shim する。
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const member = (over: Partial<ProjectMember> = {}): ProjectMember => ({
  id: 'm1',
  userId: 'u1',
  name: '山田 太郎',
  email: 'taro@example.com',
  organizationName: 'Acme',
  memberType: 'production',
  jobTitle: null,
  avatarUrl: null,
  roleType: 'editor',
  sortOrder: 0,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

/** projectId=p1 の MembersPage を <Routes> 配下に描画 (useParams 解決のため)。 */
function renderMembers(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId/members" element={<MembersPage />} />
    </Routes>,
    { route },
  );
}

const MANAGE = '/projects/p1/members?tab=manage';

/**
 * 参加者に追加できる候補 (#202 / #238)。
 * サーバーが「このプロジェクトの組織から、既に居る人を除いて」返すもの。
 */
const CANDIDATES = {
  candidates: [
    {
      userId: 'u9',
      name: '新規 太郎',
      organizationName: 'NewCo',
      avatarUrl: null,
      defaultProjectRole: 'editor',
    },
  ],
  joinedCount: 1,
  pendingCount: 0,
};

/** members 一覧 GET をスタブする。招待一覧は既定で空。 */
function stubMembers(
  members: ProjectMember[],
  candidates: typeof CANDIDATES = CANDIDATES,
) {
  server.use(
    http.get('*/api/v1/projects/p1/members/candidates', () =>
      HttpResponse.json({ data: candidates }),
    ),
    http.get('*/api/v1/projects/p1/members', () => HttpResponse.json({ data: members })),
    http.get('*/api/v1/projects/p1/invitations', () => HttpResponse.json({ data: [] })),
  );
}

/** 未受諾の招待をスタブする (座席を消費している招待)。 */
function stubInvitations(invitations: Array<{ id: string; memberId: string; email: string }>) {
  server.use(
    http.get('*/api/v1/projects/p1/invitations', () =>
      HttpResponse.json({
        data: invitations.map((i) => ({
          ...i,
          roleType: 'editor',
          memberName: '招待中',
          invitedByUserId: null,
          expiresAt: '2026-12-31T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        })),
      }),
    ),
  );
}

describe('MembersPage 管理タブ (integration)', () => {
  it('ローディング中はスケルトンを表示する', async () => {
    let resolve!: (v: Response) => void;
    server.use(
      http.get(
        '*/api/v1/projects/p1/members',
        () => new Promise<Response>((r) => {
          resolve = r;
        }),
      ),
      http.get('*/api/v1/projects/p1/invitations', () => HttpResponse.json({ data: [] })),
    );

    const { container } = renderMembers(MANAGE);

    await waitFor(() => {
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });

    resolve(HttpResponse.json({ data: [] }));
  });

  it('参加者一覧 (制作側 + クライアント) を表で描画する', async () => {
    stubMembers([
      member(),
      member({
        id: 'm2',
        name: '鈴木 花子',
        email: 'hanako@example.com',
        organizationName: 'クライアント社',
        memberType: 'client',
      }),
    ]);

    renderMembers(MANAGE);

    expect(await screen.findByText('山田 太郎')).toBeInTheDocument();
    expect(screen.getByText('鈴木 花子')).toBeInTheDocument();
    expect(screen.getByText('制作チーム')).toBeInTheDocument();
    expect(screen.getByText('クライアント')).toBeInTheDocument();
  });

  it('参加者が空でも表が描画される', async () => {
    stubMembers([]);

    renderMembers(MANAGE);

    // テーブルヘッダの描画を待つ (query.data 解決後に Table が出る)。
    expect(await screen.findByText('氏名')).toBeInTheDocument();
    expect(screen.getByText('参加者一覧')).toBeInTheDocument();
    // 削除ボタンは 1 つも無い (行が無いため)。
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
  });

  it('取得失敗時はエラーメッセージを表示する', async () => {
    server.use(
      http.get('*/api/v1/projects/p1/members', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );

    renderMembers(MANAGE);

    expect(await screen.findByText('参加者の取得に失敗しました')).toBeInTheDocument();
  });

  it('参加者を追加できる (フォーム入力 → 送信 → リクエスト捕捉 → 再取得)', async () => {
    const initial = [member()];
    let postBody: unknown = null;
    let listCallCount = 0;
    stubMembers(initial);
    server.use(
      http.get('*/api/v1/projects/p1/members', () => {
        listCallCount += 1;
        // 追加後の再取得では新メンバーを含める。
        const data =
          listCallCount > 1
            ? [...initial, member({ id: 'm9', name: '新規 太郎', email: 'new@example.com' })]
            : initial;
        return HttpResponse.json({ data });
      }),
      http.post('*/api/v1/projects/p1/members', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ data: [] });
      }),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderMembers(MANAGE);

    await screen.findByText('山田 太郎');
    await user.click(screen.getByRole('button', { name: /参加者を追加/ }));

    // 参加者は組織メンバーから選ぶ (#202)。氏名やメールは手入力しない
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'メンバー' }));
    await user.click(await screen.findByRole('option', { name: /新規 太郎/ }));

    await user.click(within(dialog).getByRole('button', { name: /追加する/ }));

    // POST が想定ボディで送られたこと。
    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      members: [{ userId: 'u9', memberType: 'production', roleType: 'editor' }],
    });

    // 再取得で新メンバーが一覧に出ること。
    expect(await screen.findByText('新規 太郎')).toBeInTheDocument();
  });

  it('メンバー未選択のままではリクエストを送らない (#202)', async () => {
    stubMembers([member()]);
    let posted = false;
    server.use(
      http.post('*/api/v1/projects/p1/members', () => {
        posted = true;
        return HttpResponse.json({ data: [] });
      }),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderMembers(MANAGE);

    await screen.findByText('山田 太郎');
    await user.click(screen.getByRole('button', { name: /参加者を追加/ }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /追加する/ }));

    // クライアント側 zod バリデーションでエラー表示され、POST は飛ばない。
    expect(await within(dialog).findByText('メンバーを選択してください')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('既に参加している人は候補に出さない (#202)', async () => {
    // u1 は既に参加者なので、選べるのは u9 だけ
    stubMembers([member()]);

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderMembers(MANAGE);

    await screen.findByText('山田 太郎');
    await user.click(screen.getByRole('button', { name: /参加者を追加/ }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'メンバー' }));

    expect(await screen.findByRole('option', { name: /新規 太郎/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /山田 太郎/ })).not.toBeInTheDocument();
  });

  it('追加 API がエラーを返してもダイアログは閉じない', async () => {
    stubMembers([member()]);
    server.use(
      http.post('*/api/v1/projects/p1/members', () =>
        HttpResponse.json(
          { error: { code: 'ALREADY_MEMBER', message: '既に参加者です' } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderMembers(MANAGE);

    await screen.findByText('山田 太郎');
    await user.click(screen.getByRole('button', { name: /参加者を追加/ }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'メンバー' }));
    await user.click(await screen.findByRole('option', { name: /新規 太郎/ }));
    await user.click(within(dialog).getByRole('button', { name: /追加する/ }));

    // 失敗時はダイアログが開いたまま (onClose が呼ばれない)。
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /追加する/ })).toBeEnabled(),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('参加者を削除できる (確認ダイアログ → DELETE → 再取得)', async () => {
    let listCallCount = 0;
    let deleteCalled = false;
    server.use(
      http.get('*/api/v1/projects/p1/members', () => {
        listCallCount += 1;
        const data = listCallCount > 1 ? [] : [member()];
        return HttpResponse.json({ data });
      }),
      http.delete('*/api/v1/projects/p1/members/m1', () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderMembers(MANAGE);

    await screen.findByText('山田 太郎');
    await user.click(screen.getByRole('button', { name: '削除' }));

    const alert = await screen.findByRole('alertdialog');
    expect(
      within(alert).getByText('「山田 太郎」をプロジェクトから外しますか？'),
    ).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: '削除' }));

    await waitFor(() => expect(deleteCalled).toBe(true));
    // 再取得後、一覧から消える。
    await waitFor(() => expect(screen.queryByText('山田 太郎')).not.toBeInTheDocument());
  });

  it('削除できない参加者は理由をそのまま出し、一覧から消さない', async () => {
    stubMembers([member()]);
    server.use(
      http.delete('*/api/v1/projects/p1/members/m1', () =>
        HttpResponse.json(
          {
            error: {
              code: 'MEMBER_HAS_ACTIVE_PLANS',
              message:
                'この参加者は 予定 3 件の担当 に設定されているため削除できません。担当を別の参加者へ変更してから、もう一度お試しください。',
            },
          },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderMembers(MANAGE);

    await screen.findByText('山田 太郎');
    await user.click(screen.getByRole('button', { name: '削除' }));
    const alert = await screen.findByRole('alertdialog');
    await user.click(within(alert).getByRole('button', { name: '削除' }));

    // 「削除に失敗しました」ではなく、何件直せばいいのかが出ること
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('予定 3 件の担当')),
    );
    expect(screen.getByText('山田 太郎')).toBeInTheDocument();
  });
});

describe('MembersPage かんばんタブ + 共通 (integration)', () => {
  it('projectId が無い場合は NotFound を表示する', () => {
    renderWithProviders(
      <Routes>
        <Route path="/members" element={<MembersPage />} />
      </Routes>,
      { route: '/members' },
    );

    expect(screen.getByText('プロジェクトが見つかりませんでした。')).toBeInTheDocument();
  });

  it('既定 (かんばん) タブで担当者ボードを描画する', async () => {
    server.use(
      http.get('*/api/v1/projects/p1/members', () =>
        HttpResponse.json({ data: [member()] }),
      ),
      http.get('*/api/v1/projects/p1/items', () => HttpResponse.json({ data: [] })),
      http.get('*/api/v1/projects/p1/plans', () => HttpResponse.json({ data: [] })),
    );

    renderMembers('/projects/p1/members');

    // 担当者ボード (かんばん) のヘッダとメンバー列が描画される。
    expect(await screen.findByText('担当者ボード')).toBeInTheDocument();
    expect(await screen.findByText('山田 太郎')).toBeInTheDocument();
    expect(screen.getByText('担当中の予定はありません')).toBeInTheDocument();
  });

  it('タブを「管理」へ切り替えると参加者一覧を表示する', async () => {
    server.use(
      http.get('*/api/v1/projects/p1/members', () =>
        HttpResponse.json({ data: [member()] }),
      ),
      http.get('*/api/v1/projects/p1/items', () => HttpResponse.json({ data: [] })),
      http.get('*/api/v1/projects/p1/plans', () => HttpResponse.json({ data: [] })),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderMembers('/projects/p1/members');

    await screen.findByText('担当者ボード');
    await user.click(screen.getByRole('tab', { name: /管理/ }));

    expect(await screen.findByText('参加者一覧')).toBeInTheDocument();
  });
});

// =============================================================================
// 権限ロール・招待 (Phase 0.5)
// =============================================================================
describe('MembersPage 権限ロール (integration)', () => {
  it('権限セレクトを変更すると PATCH でロールが送られる', async () => {
    stubMembers([
      member({ id: 'm1', name: '管理 太郎', roleType: 'admin' }),
      member({ id: 'm2', name: '編集 花子', roleType: 'editor' }),
    ]);
    let patched: unknown = null;
    server.use(
      http.patch('*/api/v1/projects/p1/members/m2', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ data: member({ id: 'm2', roleType: 'viewer' }) });
      }),
    );
    renderMembers(MANAGE);

    const select = await screen.findByRole('combobox', { name: '編集 花子 の権限' });
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole('option', { name: '閲覧者' }));

    await waitFor(() => expect(patched).toEqual({ roleType: 'viewer' }));
  });

  it('管理者が 1 名しかいない場合はその権限セレクトと削除を無効化する', async () => {
    stubMembers([
      member({ id: 'm1', name: '管理 太郎', roleType: 'admin' }),
      member({ id: 'm2', name: '編集 花子', roleType: 'editor' }),
    ]);
    renderMembers(MANAGE);

    expect(await screen.findByRole('combobox', { name: '管理 太郎 の権限' })).toBeDisabled();
    expect(screen.getByText('管理者は 1 名以上必要です')).toBeInTheDocument();
    // 編集者側は操作できる
    expect(screen.getByRole('combobox', { name: '編集 花子 の権限' })).not.toBeDisabled();
  });

  it('未受諾の招待は「招待中」バッジと取り消しボタンを出す', async () => {
    stubMembers([member({ id: 'm1', name: '招待 太郎', roleType: 'editor' })]);
    stubInvitations([{ id: 'inv1', memberId: 'm1', email: 'invitee@example.test' }]);
    let revoked = false;
    server.use(
      http.delete('*/api/v1/projects/p1/invitations/inv1', () => {
        revoked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderMembers(MANAGE);

    expect(await screen.findByText('招待中')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '招待を取り消す' }));

    await waitFor(() => expect(revoked).toBe(true));
  });

  it('追加時に権限を選べ、既定は組織で設定された権限になる (#202)', async () => {
    stubMembers([member({ id: 'm1', roleType: 'admin' })]);
    let posted: unknown = null;
    server.use(
      http.post('*/api/v1/projects/p1/members', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ data: [] }, { status: 201 });
      }),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderMembers(MANAGE);

    await user.click(await screen.findByRole('button', { name: /参加者を追加/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'メンバー' }));
    await user.click(await screen.findByRole('option', { name: /新規 太郎/ }));

    // u9 の組織での既定ロールは editor。その場で変更もできる
    await user.click(within(dialog).getByRole('combobox', { name: '権限' }));
    await user.click(await screen.findByRole('option', { name: '管理者' }));
    await user.click(within(dialog).getByRole('button', { name: /追加する/ }));

    await waitFor(() =>
      expect(posted).toMatchObject({
        members: [{ userId: 'u9', roleType: 'admin' }],
      }),
    );
  });

  it('組織外の人はここでは招待できず、メンバー管理へ送る (#202)', async () => {
    stubMembers([member({ id: 'm1', roleType: 'admin' })]);
    renderMembers(MANAGE);

    expect(await screen.findByRole('link', { name: /メンバー管理/ })).toHaveAttribute(
      'href',
      '/settings/members',
    );
    expect(screen.queryByRole('button', { name: /招待を送る/ })).not.toBeInTheDocument();
  });
});

describe('追加できる人が居ないときの理由 (#238)', () => {
  /** 追加ダイアログを開いて中身を返す */
  async function openAddDialog() {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderMembers(MANAGE);
    await user.click(await screen.findByRole('button', { name: /参加者を追加/ }));
    return screen.findByRole('dialog');
  }

  it('全員が既に参加済みなら、そう言う (招待を促さない)', async () => {
    stubMembers([member({ id: 'm1', roleType: 'admin' })], {
      candidates: [],
      joinedCount: 3,
      pendingCount: 0,
    });

    const dialog = await openAddDialog();

    expect(await within(dialog).findByText(/3 名は、全員このプロジェクトに参加済み/)).toBeInTheDocument();
    // 「まだ居ないので招待して」は誤案内になる
    expect(within(dialog).queryByText(/先にそちらから招待してください/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /追加する/ })).toBeDisabled();
  });

  it('招待中の人しか居なければ、承諾待ちだと分かる', async () => {
    stubMembers([member({ id: 'm1', roleType: 'admin' })], {
      candidates: [],
      joinedCount: 0,
      pendingCount: 2,
    });

    const dialog = await openAddDialog();

    expect(await within(dialog).findByText(/招待中の 2 名は、まだ承諾されていない/)).toBeInTheDocument();
  });

  it('組織にまだ誰も居なければ、メンバー管理へ送る', async () => {
    stubMembers([member({ id: 'm1', roleType: 'admin' })], {
      candidates: [],
      joinedCount: 0,
      pendingCount: 0,
    });

    const dialog = await openAddDialog();

    expect(await within(dialog).findByText(/先にそちらから招待してください/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'メンバー管理' })).toHaveAttribute(
      'href',
      '/settings/members',
    );
  });

  it('候補の取得に失敗したら、黙って空にせずエラーを出す', async () => {
    stubMembers([member({ id: 'm1', roleType: 'admin' })]);
    server.use(
      http.get('*/api/v1/projects/p1/members/candidates', () =>
        HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'x' } }, { status: 403 }),
      ),
    );

    const dialog = await openAddDialog();

    expect(
      await within(dialog).findByText(/追加できるメンバーを取得できませんでした/),
    ).toBeInTheDocument();
    // 原因が分からないまま「招待してください」と案内しない
    expect(within(dialog).queryByText(/先にそちらから招待してください/)).not.toBeInTheDocument();
  });
});

describe('参加者の区別 (#160)', () => {
  it('アカウントを持つ人と表示されるだけの人をバッジで見分けられる', async () => {
    stubMembers([
      member({ id: 'm1', userId: 'u1', name: 'アカウントの人' }),
      member({ id: 'm2', userId: null, name: '表示だけの人' }),
    ]);
    renderMembers('/projects/p1/members?tab=manage');

    const withAccount = (await screen.findByText('アカウントの人')).closest('tr')!;
    const displayOnly = screen.getByText('表示だけの人').closest('tr')!;

    expect(within(withAccount).getByText('アカウント')).toBeInTheDocument();
    expect(within(displayOnly).getByText('表示のみ')).toBeInTheDocument();
  });

  it('ログインできない相手には権限セレクトを出さない', async () => {
    stubMembers([
      member({ id: 'm1', userId: 'u1', name: 'アカウントの人', roleType: 'admin' }),
      member({ id: 'm2', userId: null, name: '表示だけの人' }),
      // 管理者が 1 名だとセレクトが無効化されるため、もう 1 名管理者を置く
      member({ id: 'm3', userId: 'u3', name: 'もう一人の管理者', roleType: 'admin' }),
    ]);
    renderMembers('/projects/p1/members?tab=manage');

    await screen.findByText('アカウントの人');
    expect(
      screen.getByRole('combobox', { name: 'アカウントの人 の権限' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: '表示だけの人 の権限' }),
    ).not.toBeInTheDocument();
  });
});
