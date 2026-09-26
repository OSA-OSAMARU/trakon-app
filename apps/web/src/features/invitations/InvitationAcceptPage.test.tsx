import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import type { InvitationVerify } from './api';
import type { SyncResponse } from '@/features/auth/api';
import type * as ReactRouterDom from 'react-router-dom';

// supabase をモックして session を制御する。
const getSession = vi.fn();
const onAuthStateChange = vi.fn();
const signOut = vi.fn();
const signInWithPassword = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => getSession(...a),
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      signOut: (...a: unknown[]) => signOut(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
    },
  },
}));

// react-router-dom を部分モックし useParams(token) / useNavigate を制御する。
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterDom>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ token: 'tok-123' }),
  };
});

// sonner の toast を spy する。
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastMessage = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    message: (...a: unknown[]) => toastMessage(...a),
  },
}));

import { InvitationAcceptPage } from './InvitationAcceptPage';

const verifyData: InvitationVerify = {
  scope: 'project',
  project: { id: 'proj-1', name: 'サンプル制作案件' },
  projects: [{ id: 'proj-1', name: 'サンプル制作案件' }],
  organizationName: '制作会社A',
  invitee: {
    name: '鈴木 花子',
    email: 'hanako@example.com',
    organizationName: 'Client Co',
    roleType: 'viewer',
  },
  expiresAt: '2026-07-01T00:00:00.000Z',
};

/** メンバー管理から発行される組織単位の招待 (#160)。project は null になる */
const orgVerifyData: InvitationVerify = {
  scope: 'org',
  project: null,
  projects: [
    { id: 'proj-1', name: 'サンプル制作案件' },
    { id: 'proj-2', name: '採用サイト' },
  ],
  organizationName: '河津正和 の組織',
  invitee: {
    name: '河津',
    email: 'hanako@example.com',
    organizationName: '',
    roleType: 'editor',
  },
  expiresAt: '2026-07-01T00:00:00.000Z',
};

const SYNC_OK: SyncResponse = {
  requiresProfileCompletion: false,
  user: {
    id: 'u1',
    email: 'hanako@example.com',
    fullName: '鈴木 花子',
    displayName: 'ハナコ',
    organizationName: null,
    jobTitle: null,
    notificationEmail: null,
    effectiveNotificationEmail: 'hanako@example.com',
    avatarUrl: null,
    primaryAuthMethod: 'password',
    createdAt: '2026-06-01T00:00:00.000Z',
  },
};

function stubVerify(status = 200, data: InvitationVerify = verifyData) {
  server.use(
    http.get('*/api/v1/invitations/:token', () => {
      if (status >= 400) {
        return HttpResponse.json(
          { error: { code: 'INVITATION_NOT_FOUND', message: 'not found' } },
          { status },
        );
      }
      return HttpResponse.json({ data });
    }),
  );
}

function stubSync(sync: SyncResponse = SYNC_OK) {
  server.use(http.post('*/api/v1/auth/me/sync', () => HttpResponse.json({ data: sync })));
}

beforeEach(() => {
  // 既定: 未認証 (session null)
  getSession.mockResolvedValue({ data: { session: null } });
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  signOut.mockResolvedValue({ error: null });
  signInWithPassword.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InvitationAcceptPage', () => {
  it('有効な招待を取得して内容 (プロジェクト名/招待先/権限) を描画する', async () => {
    stubVerify();
    renderWithProviders(<InvitationAcceptPage />);

    expect(await screen.findByText('プロジェクトへの招待')).toBeInTheDocument();
    expect(screen.getByText('サンプル制作案件')).toBeInTheDocument();
    expect(screen.getByText('hanako@example.com')).toBeInTheDocument();
    expect(screen.getByText('鈴木 花子')).toBeInTheDocument();
    // 区分ではなく権限を出す (操作可否の根拠はロールだけ)
    expect(screen.getByText('閲覧者')).toBeInTheDocument();
  });

  it('組織単位の招待 (project が null) でも内容を描画する', async () => {
    // #228: project 前提の実装だと描画中に落ちて画面が真っ白になっていた
    stubVerify(200, orgVerifyData);
    renderWithProviders(<InvitationAcceptPage />);

    expect(await screen.findByText('組織への招待')).toBeInTheDocument();
    expect(screen.getByText('河津正和 の組織')).toBeInTheDocument();
    expect(screen.getByText('hanako@example.com')).toBeInTheDocument();
    expect(screen.getByText('編集者')).toBeInTheDocument();
  });

  it('参加するプロジェクトを受諾前に出す。組織単位で複数なら全部並べる (#258)', async () => {
    stubVerify(200, orgVerifyData);
    renderWithProviders(<InvitationAcceptPage />);

    await screen.findByText('組織への招待');
    const list = screen.getByText('参加するプロジェクト').nextElementSibling as HTMLElement;
    expect(within(list).getByText('サンプル制作案件')).toBeInTheDocument();
    expect(within(list).getByText('採用サイト')).toBeInTheDocument();
  });

  it('参加するプロジェクトが未指定なら、そうと分かる文言を出す (#258)', async () => {
    stubVerify(200, { ...orgVerifyData, projects: [] });
    renderWithProviders(<InvitationAcceptPage />);

    await screen.findByText('組織への招待');
    expect(
      screen.getByText('まだ指定されていません（参加後に追加されます）'),
    ).toBeInTheDocument();
  });

  it('氏名が空の招待でも描画できる (招待行に氏名が無い場合)', async () => {
    stubVerify(200, { ...orgVerifyData, invitee: { ...orgVerifyData.invitee, name: '' } });
    renderWithProviders(<InvitationAcceptPage />);

    expect(await screen.findByText('組織への招待')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  // #231 でアカウントを持たない人の行き止まりを解消し、#233 で登録自体を
  // この画面に取り込んだ。別画面へ送らないことがこの導線の要点。
  it('未認証時は「新規登録して参加」でこの画面に登録フォームを開く', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubVerify();
    renderWithProviders(<InvitationAcceptPage />);

    await user.click(await screen.findByRole('button', { name: /新規登録して参加/ }));

    expect(screen.getByLabelText('氏名')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
    // メールの入力欄は出さない (招待に書かれたアドレスで作るため)
    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('未認証時は「ログインして参加」から /login?next=... へ、招待先メール付きで遷移する', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubVerify();
    renderWithProviders(<InvitationAcceptPage />);

    await user.click(await screen.findByRole('button', { name: /ログインして参加/ }));
    expect(navigate).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent('/invitations/tok-123')}&email=${encodeURIComponent('hanako@example.com')}`,
    );
  });

  // #231: 押してから 403 で弾かれるより、押す前に気付けるほうがよい
  it('招待先と違うアカウントでログイン中は承諾を止め、入り直しを促す', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    stubVerify();
    stubSync({
      ...SYNC_OK,
      user: { ...SYNC_OK.user!, email: 'someone-else@example.com' },
    } as SyncResponse);
    renderWithProviders(<InvitationAcceptPage />);

    expect(await screen.findByRole('button', { name: '承諾' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /別のアカウントでログイン/ }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent('/invitations/tok-123')}&email=${encodeURIComponent('hanako@example.com')}`,
    );
  });

  // #233: 招待メール → 確認メールの 2 通待ちを無くす導線
  describe('招待からの直接登録', () => {
    /** 登録フォームを開いて必要項目を埋める */
    async function fillSignupForm(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByRole('button', { name: /新規登録して参加/ }));
      await user.clear(screen.getByLabelText('表示名'));
      await user.type(screen.getByLabelText('表示名'), 'はなこ');
      await user.type(screen.getByLabelText('パスワード'), 'abcd1234!');
      await user.type(screen.getByLabelText('パスワード（確認）'), 'abcd1234!');
      await user.click(screen.getByLabelText(/利用規約/));
    }

    it('画面内で登録を終え、確認メールを挟まずに参加まで進む', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      stubVerify(200, orgVerifyData);
      let body: unknown = null;
      server.use(
        http.post('*/api/v1/invitations/:token/signup', async ({ request }) => {
          body = await request.json();
          return HttpResponse.json(
            {
              data: {
                email: 'hanako@example.com',
                accepted: { scope: 'org', project: null, members: [] },
              },
            },
            { status: 201 },
          );
        }),
      );

      renderWithProviders(<InvitationAcceptPage />);
      await fillSignupForm(user);
      await user.click(screen.getByRole('button', { name: /登録して参加/ }));

      // メールは招待が持っているので送らない
      await waitFor(() =>
        expect(body).toEqual({
          fullName: '河津',
          displayName: 'はなこ',
          password: 'abcd1234!',
        }),
      );
      // 作ったパスワードでそのままサインインし、参加先へ送る
      await waitFor(() =>
        expect(signInWithPassword).toHaveBeenCalledWith({
          email: 'hanako@example.com',
          password: 'abcd1234!',
        }),
      );
      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith('/projects', { replace: true }),
      );
    });

    it('プロジェクトつきの招待なら、そのプロジェクトへ送る', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      stubVerify();
      server.use(
        http.post('*/api/v1/invitations/:token/signup', () =>
          HttpResponse.json(
            {
              data: {
                email: 'hanako@example.com',
                accepted: {
                  scope: 'project',
                  project: { id: 'proj-1', name: 'サンプル制作案件' },
                  members: [{ id: 'm1', projectId: 'proj-1', roleType: 'viewer' }],
                },
              },
            },
            { status: 201 },
          ),
        ),
      );

      renderWithProviders(<InvitationAcceptPage />);
      await fillSignupForm(user);
      await user.click(screen.getByRole('button', { name: /登録して参加/ }));

      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith('/projects/proj-1/edit', { replace: true }),
      );
    });

    it('規約に同意していなければ送信しない', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      stubVerify();
      let called = false;
      server.use(
        http.post('*/api/v1/invitations/:token/signup', () => {
          called = true;
          return HttpResponse.json({ data: {} }, { status: 201 });
        }),
      );

      renderWithProviders(<InvitationAcceptPage />);
      await user.click(await screen.findByRole('button', { name: /新規登録して参加/ }));
      await user.type(screen.getByLabelText('パスワード'), 'abcd1234!');
      await user.type(screen.getByLabelText('パスワード（確認）'), 'abcd1234!');
      await user.click(screen.getByRole('button', { name: /登録して参加/ }));

      expect(
        await screen.findByText('利用規約とプライバシーポリシーに同意してください'),
      ).toBeInTheDocument();
      expect(called).toBe(false);
    });

    it('既に登録済みのメールならログインへの導線を出す', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      stubVerify();
      server.use(
        http.post('*/api/v1/invitations/:token/signup', () =>
          HttpResponse.json(
            {
              error: {
                code: 'EMAIL_ALREADY_REGISTERED',
                message: 'このメールアドレスは登録済みです。ログインしてから招待を受けてください。',
              },
            },
            { status: 409 },
          ),
        ),
      );

      renderWithProviders(<InvitationAcceptPage />);
      await fillSignupForm(user);
      await user.click(screen.getByRole('button', { name: /登録して参加/ }));

      expect(
        await screen.findByText(
          'このメールアドレスは登録済みです。ログインしてから招待を受けてください。',
        ),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /ログインして参加/ }));
      expect(navigate).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent('/invitations/tok-123')}&email=${encodeURIComponent('hanako@example.com')}`,
      );
    });
  });

  it('招待取得に失敗すると「招待を確認できません」を表示する', async () => {
    stubVerify(410);
    renderWithProviders(<InvitationAcceptPage />);

    expect(await screen.findByText('招待を確認できません')).toBeInTheDocument();
  });

  it('認証済み + プロフィール完了なら「承諾」を押すと accept POST → 成功トースト → プロジェクト編集へ遷移', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    stubVerify();
    stubSync();
    let accepted = false;
    server.use(
      http.post('*/api/v1/invitations/:token/accept', () => {
        accepted = true;
        return HttpResponse.json({
          data: {
            scope: 'project',
            project: { id: 'proj-1', name: 'サンプル制作案件' },
            members: [{ id: 'm1', projectId: 'proj-1', roleType: 'viewer' }],
          },
        });
      }),
    );

    renderWithProviders(<InvitationAcceptPage />);

    const acceptBtn = await screen.findByRole('button', { name: '承諾' });
    await user.click(acceptBtn);

    await waitFor(() => expect(accepted).toBe(true));
    expect(toastSuccess).toHaveBeenCalledWith('プロジェクトに参加しました');
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/projects/proj-1/edit', { replace: true }),
    );
  });

  it('組織単位の招待を受諾するとプロジェクト一覧へ遷移する', async () => {
    // 紐づくプロジェクトが 0 件のこともあるため、特定のプロジェクトへは送れない
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    stubVerify(200, orgVerifyData);
    stubSync();
    server.use(
      http.post('*/api/v1/invitations/:token/accept', () =>
        HttpResponse.json({ data: { scope: 'org', project: null, members: [] } }),
      ),
    );

    renderWithProviders(<InvitationAcceptPage />);
    await user.click(await screen.findByRole('button', { name: '承諾' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('組織に参加しました'));
    expect(navigate).toHaveBeenCalledWith('/projects', { replace: true });
  });

  it('accept で ALREADY_MEMBER エラーなら通知して /projects へ遷移する', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    stubVerify();
    stubSync();
    server.use(
      http.post('*/api/v1/invitations/:token/accept', () =>
        HttpResponse.json(
          { error: { code: 'ALREADY_MEMBER', message: 'already' } },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<InvitationAcceptPage />);

    const acceptBtn = await screen.findByRole('button', { name: '承諾' });
    await user.click(acceptBtn);

    await waitFor(() =>
      expect(toastMessage).toHaveBeenCalledWith('既にこのプロジェクトに参加しています'),
    );
    expect(navigate).toHaveBeenCalledWith('/projects', { replace: true });
  });

  it('accept で汎用エラーならエラートーストを表示し遷移しない', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    stubVerify();
    stubSync();
    server.use(
      http.post('*/api/v1/invitations/:token/accept', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'サーバエラー' } },
          { status: 500 },
        ),
      ),
    );

    renderWithProviders(<InvitationAcceptPage />);

    const acceptBtn = await screen.findByRole('button', { name: '承諾' });
    await user.click(acceptBtn);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('サーバエラー'));
    expect(navigate).not.toHaveBeenCalledWith('/projects/proj-1/edit', { replace: true });
  });
});
