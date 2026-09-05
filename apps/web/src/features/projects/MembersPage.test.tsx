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

/** ダイアログ内の input を name 属性で取得 (Label 未関連付けのため)。 */
function fieldByName(scope: HTMLElement, name: string): HTMLInputElement {
  const el = scope.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!el) throw new Error(`input[name="${name}"] が見つかりません`);
  return el;
}

/** members 一覧 GET をスタブする。招待一覧は既定で空。 */
function stubMembers(members: ProjectMember[]) {
  server.use(
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

    const dialog = await screen.findByRole('dialog');
    // Label と input が関連付けられていないため name 属性で取得する。
    await user.type(fieldByName(dialog, 'name'), '新規 太郎');
    await user.type(fieldByName(dialog, 'organizationName'), 'NewCo');
    await user.type(fieldByName(dialog, 'email'), 'new@example.com');

    await user.click(within(dialog).getByRole('button', { name: /追加する/ }));

    // POST が想定ボディで送られたこと。
    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      members: [
        {
          name: '新規 太郎',
          organizationName: 'NewCo',
          email: 'new@example.com',
          memberType: 'production',
        },
      ],
    });

    // 再取得で新メンバーが一覧に出ること。
    expect(await screen.findByText('新規 太郎')).toBeInTheDocument();
  });

  it('追加フォームのバリデーション (空欄送信) ではリクエストを送らない', async () => {
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
    expect(await within(dialog).findByText('氏名は必須')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('追加 API がエラーを返してもダイアログは閉じない', async () => {
    stubMembers([member()]);
    server.use(
      http.post('*/api/v1/projects/p1/members', () =>
        HttpResponse.json(
          { error: { code: 'MEMBER_EMAIL_TAKEN', message: '重複' } },
          { status: 422 },
        ),
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderMembers(MANAGE);

    await screen.findByText('山田 太郎');
    await user.click(screen.getByRole('button', { name: /参加者を追加/ }));

    const dialog = await screen.findByRole('dialog');
    await user.type(fieldByName(dialog, 'name'), 'X');
    await user.type(fieldByName(dialog, 'email'), 'dup@example.com');
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

  it('招待ダイアログからロール付きで招待を送れる', async () => {
    stubMembers([member({ id: 'm1', roleType: 'admin' })]);
    let posted: unknown = null;
    server.use(
      http.post('*/api/v1/projects/p1/invitations', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ data: {} }, { status: 201 });
      }),
    );
    renderMembers(MANAGE);

    await userEvent.click(await screen.findByRole('button', { name: /招待を送る/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(fieldByName(dialog, 'email'), 'invitee@example.test');
    await userEvent.click(within(dialog).getByRole('combobox', { name: '権限' }));
    await userEvent.click(await screen.findByRole('option', { name: '管理者' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '招待を送る' }));

    await waitFor(() =>
      expect(posted).toMatchObject({ email: 'invitee@example.test', roleType: 'admin' }),
    );
  });
});
