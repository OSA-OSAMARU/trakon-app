import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import type { InvitationVerify } from './api';
import type { SyncResponse } from '@/features/auth/api';
import type * as ReactRouterDom from 'react-router-dom';

// supabase をモックして session を制御する。
const getSession = vi.fn();
const onAuthStateChange = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => getSession(...a),
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
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
  project: { id: 'proj-1', name: 'サンプル制作案件' },
  invitedMember: {
    id: 'm1',
    name: '鈴木 花子',
    email: 'hanako@example.com',
    organizationName: 'Client Co',
    memberType: 'client',
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InvitationAcceptPage', () => {
  it('有効な招待を取得して内容 (プロジェクト名/招待先/種別) を描画する', async () => {
    stubVerify();
    renderWithProviders(<InvitationAcceptPage />);

    expect(await screen.findByText('プロジェクトへの招待')).toBeInTheDocument();
    expect(screen.getByText('サンプル制作案件')).toBeInTheDocument();
    expect(screen.getByText('hanako@example.com')).toBeInTheDocument();
    expect(screen.getByText('鈴木 花子')).toBeInTheDocument();
    // memberType=client → 「クライアント」
    expect(screen.getByText('クライアント')).toBeInTheDocument();
  });

  it('未認証時は「ログインして承諾」ボタンを表示し、押すと /login?next=... へ遷移する', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubVerify();
    renderWithProviders(<InvitationAcceptPage />);

    const loginBtn = await screen.findByRole('button', { name: /ログインして承諾/ });
    await user.click(loginBtn);
    expect(navigate).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent('/invitations/tok-123')}`,
    );
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
          data: { project: { id: 'proj-1', name: 'サンプル制作案件' }, member: { id: 'm1', memberType: 'client' } },
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
