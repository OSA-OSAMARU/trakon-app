import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import type * as ReactRouterDom from 'react-router-dom';

// supabase はモックして getSession を制御する (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }),
    },
  },
}));

// react-router-dom は部分モックして useNavigate のみ差し替える (MemoryRouter は本物を維持)。
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof ReactRouterDom>()),
  useNavigate: () => navigateMock,
}));

// sonner の toast は副作用のみなので no-op モックにする。
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProjectCreatePage } from './ProjectCreatePage';

// Radix が jsdom で必要とする API のシム。
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  navigateMock.mockClear();
});

/** ポインタチェックを無効化した userEvent をセットアップする。 */
function setup() {
  return userEvent.setup({ pointerEventsCheck: 0 });
}

/** 制作物 (items) の入力欄を全て取得する。 */
function getItemInputs(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name^="items."][name$=".name"]'),
  );
}

/** 基本情報 (名前・日付) を埋める。 */
async function fillBasics(user: ReturnType<typeof setup>, name = 'サイトリニューアル') {
  await user.type(screen.getByPlaceholderText('例：ブランドサイト制作'), name);
  // DateField のラベルは htmlFor 紐付けがないため name 属性で取得する。
  const start = document.querySelector<HTMLInputElement>('input[name="startDate"]')!;
  const end = document.querySelector<HTMLInputElement>('input[name="endDate"]')!;
  await user.clear(start);
  await user.type(start, '2026-01-01');
  await user.clear(end);
  await user.type(end, '2026-12-31');
}

describe('ProjectCreatePage (integration)', () => {
  it('初期表示: フォームの各セクションと初期行を描画する', () => {
    renderWithProviders(<ProjectCreatePage />, { route: '/projects/new' });

    // 基本情報
    expect(screen.getByText('基本情報')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('例：ブランドサイト制作')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('例：株式会社灯和食品')).toBeInTheDocument();
    expect(screen.getByText('開始日')).toBeInTheDocument();
    expect(screen.getByText('終了日')).toBeInTheDocument();
    expect(document.querySelector('input[name="startDate"]')).toBeInTheDocument();
    expect(document.querySelector('input[name="endDate"]')).toBeInTheDocument();

    // 制作物: 初期 1 行
    expect(screen.getByText('制作物')).toBeInTheDocument();
    expect(getItemInputs()).toHaveLength(1);
    // 初期行が 1 件のとき削除ボタンは disabled
    expect(screen.getByRole('button', { name: '制作物 1 を削除' })).toBeDisabled();

    // 参加者: 初期 1 行
    expect(screen.getByText('参加者')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '参加者 1 を削除' })).toBeDisabled();
    // 職種・区分の選択欄
    expect(screen.getByLabelText('参加者 1 の職種')).toBeInTheDocument();
    expect(screen.getByLabelText('参加者 1 の区分')).toBeInTheDocument();

    // 送信ボタン
    expect(screen.getByRole('button', { name: 'プロジェクトを作成' })).toBeInTheDocument();
  });

  it('制作物の行を追加・削除できる', async () => {
    const user = setup();
    renderWithProviders(<ProjectCreatePage />, { route: '/projects/new' });

    expect(getItemInputs()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '制作物を追加' }));
    expect(getItemInputs()).toHaveLength(2);

    // 2 行になると削除ボタンが有効化される
    expect(screen.getByRole('button', { name: '制作物 1 を削除' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '制作物 2 を削除' }));
    expect(getItemInputs()).toHaveLength(1);
  });

  it('参加者の行を追加・削除できる', async () => {
    const user = setup();
    renderWithProviders(<ProjectCreatePage />, { route: '/projects/new' });

    expect(screen.getAllByRole('button', { name: /^参加者 \d+ を削除$/ })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '参加者を追加' }));
    expect(screen.getAllByRole('button', { name: /^参加者 \d+ を削除$/ })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '参加者 2 を削除' }));
    expect(screen.getAllByRole('button', { name: /^参加者 \d+ を削除$/ })).toHaveLength(1);
  });

  it('バリデーション: 必須・空の制作物は送信をブロックしエラーを表示する', async () => {
    const user = setup();
    // 送信されないことを保証するため、呼ばれたら fail させるハンドラを登録。
    let posted = false;
    server.use(
      http.post('*/api/v1/projects', () => {
        posted = true;
        return HttpResponse.json({ data: {} }, { status: 201 });
      }),
    );

    renderWithProviders(<ProjectCreatePage />, { route: '/projects/new' });

    // 名前未入力・制作物空のまま送信
    await user.click(screen.getByRole('button', { name: 'プロジェクトを作成' }));

    expect(await screen.findByText('プロジェクト名は必須です')).toBeInTheDocument();
    // 空の制作物に対するカスタムエラー
    expect(await screen.findByText('制作物を 1 件以上入力してください')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('正常系: 入力して送信すると items/members を含む POST が飛び、編集画面へ遷移する', async () => {
    const user = setup();
    let captured: unknown = null;
    server.use(
      http.post('*/api/v1/projects', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(
          {
            data: {
              id: 'proj-1',
              name: 'サイトリニューアル',
              startDate: '2026-01-01',
              endDate: '2026-12-31',
              status: 'active',
              archivedAt: null,
              role: 'admin',
              clientName: null,
              progressManager: null,
              overdueCount: 0,
              createdBy: 'u1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              counts: { memberCount: 1, itemCount: 1 },
            },
          },
          { status: 201 },
        );
      }),
    );

    renderWithProviders(<ProjectCreatePage />, { route: '/projects/new' });

    await fillBasics(user);

    // 制作物 1 件入力
    await user.type(getItemInputs()[0]!, 'トップページ');

    // 参加者 1 件入力 (氏名 + メール)。Field ラベルは htmlFor 紐付けがないため name で取得。
    const nameField = document.querySelector<HTMLInputElement>('input[name="members.0.name"]')!;
    const emailField = document.querySelector<HTMLInputElement>('input[name="members.0.email"]')!;
    await user.type(nameField, '山田 太郎');
    await user.type(emailField, 'taro@example.com');

    // 進行責任者は入力済み参加者から選ぶ (Figma node 78:18 で必須)
    await user.click(screen.getByLabelText('進行責任者'));
    await user.click(await screen.findByRole('option', { name: /山田 太郎/ }));

    await user.click(screen.getByRole('button', { name: 'プロジェクトを作成' }));

    await waitFor(() => expect(captured).not.toBeNull());

    expect(captured).toMatchObject({
      name: 'サイトリニューアル',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      items: [{ name: 'トップページ' }],
      members: [
        {
          name: '山田 太郎',
          email: 'taro@example.com',
          organizationName: '',
          memberType: 'production',
        },
      ],
      progressManagerIndex: 0,
    });

    // onSuccess で編集画面へ遷移する
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/projects/proj-1/edit', { replace: true }),
    );
  });

  it('サーバエラー系: POST 422 で遷移せずエラーが伝播する', async () => {
    const user = setup();
    const { toast } = await import('sonner');
    server.use(
      http.post('*/api/v1/projects', () =>
        HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: '名前が不正です' } },
          { status: 422 },
        ),
      ),
    );

    renderWithProviders(<ProjectCreatePage />, { route: '/projects/new' });

    await fillBasics(user);
    await user.type(getItemInputs()[0]!, 'トップページ');

    await user.click(screen.getByRole('button', { name: 'プロジェクトを作成' }));

    // onError で toast.error が API のメッセージで呼ばれる
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('名前が不正です'));
    // 遷移しない
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
