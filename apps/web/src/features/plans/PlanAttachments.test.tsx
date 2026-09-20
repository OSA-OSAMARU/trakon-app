import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';

import { PlanAttachments } from './PlanAttachments';
import type { Attachment } from './api';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }),
    },
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PROJECT_ID = 'proj-1';
const ITEM_ID = 'item-1';
const PLAN_ID = 'plan-1';
const BASE = `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/attachments`;

const MINE: Attachment = {
  id: 'att-1',
  filename: '入稿データ.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2_097_152,
  uploader: { id: 'm-me', name: '自分 太郎' },
  downloadUrl: 'https://signed.test/a',
  createdAt: '2026-09-20T00:00:00.000Z',
};

const OTHERS: Attachment = {
  ...MINE,
  id: 'att-2',
  filename: '支給素材.zip',
  sizeBytes: 512,
  uploader: { id: 'm-other', name: '他人 花子' },
  downloadUrl: 'https://signed.test/b',
};

function stub(rows: Attachment[]) {
  server.use(http.get(BASE, () => HttpResponse.json({ data: rows })));
}

function renderList(over: Partial<React.ComponentProps<typeof PlanAttachments>> = {}) {
  return renderWithProviders(
    <PlanAttachments
      projectId={PROJECT_ID}
      itemId={ITEM_ID}
      planId={PLAN_ID}
      myMemberId="m-me"
      canUpload
      isAdmin={false}
      {...over}
    />,
  );
}

function row(filename: string): HTMLElement {
  return screen.getByText(filename).closest('li')!;
}

describe('PlanAttachments (integration)', () => {
  it('ファイル名・サイズ・添付した人を出す', async () => {
    stub([MINE]);
    renderList();

    expect(await screen.findByText('入稿データ.pdf')).toBeInTheDocument();
    expect(screen.getByText('2.0 MB ・ 自分 太郎')).toBeInTheDocument();
  });

  it('ダウンロードは署名付き URL を使う (直リンクは持たない)', async () => {
    stub([MINE]);
    renderList();

    const link = await screen.findByRole('link', { name: '入稿データ.pdf をダウンロード' });
    expect(link).toHaveAttribute('href', 'https://signed.test/a');
    expect(link).toHaveAttribute('download', '入稿データ.pdf');
  });

  it('署名付き URL を発行できなかったものはダウンロードを出さない', async () => {
    // 押しても失敗するボタンは「壊れている」ように見える
    stub([{ ...MINE, downloadUrl: null }]);
    renderList();

    await screen.findByText('入稿データ.pdf');
    expect(screen.queryByRole('link', { name: /ダウンロード/ })).not.toBeInTheDocument();
  });

  it('消せるのは自分が添付したものだけ', async () => {
    stub([MINE, OTHERS]);
    renderList();

    await screen.findByText('入稿データ.pdf');
    expect(within(row('入稿データ.pdf')).getByRole('button', { name: /削除/ })).toBeInTheDocument();
    expect(within(row('支給素材.zip')).queryByRole('button', { name: /削除/ })).toBeNull();
  });

  it('管理者は他人の添付も消せる', async () => {
    stub([OTHERS]);
    renderList({ isAdmin: true });

    await screen.findByText('支給素材.zip');
    expect(within(row('支給素材.zip')).getByRole('button', { name: /削除/ })).toBeInTheDocument();
  });

  it('削除すると DELETE を呼んで一覧を取り直す', async () => {
    let deleted = false;
    let listCalls = 0;
    server.use(
      http.get(BASE, () => {
        listCalls += 1;
        return HttpResponse.json({ data: listCalls > 1 ? [] : [MINE] });
      }),
      http.delete(`${BASE}/att-1`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderList();

    await screen.findByText('入稿データ.pdf');
    await user.click(screen.getByRole('button', { name: '入稿データ.pdf を削除' }));

    await waitFor(() => expect(deleted).toBe(true));
    expect(await screen.findByText('添付ファイルはありません。')).toBeInTheDocument();
  });

  it('ファイルを選ぶと multipart で POST する', async () => {
    // multipart の boundary はプラットフォーム (fetch) が付けるもので、
    // jsdom + Node のバージョンによっては MSW まで伝わらない。
    // ここで確かめるのはアプリ側の責務に絞る:
    //   「添付の EP へ POST する」「FormData なのに JSON の Content-Type を付けない」
    const posted: { called: boolean; contentType: string | null } = {
      called: false,
      contentType: null,
    };
    let listCalls = 0;
    server.use(
      http.get(BASE, () => {
        listCalls += 1;
        return HttpResponse.json({ data: listCalls > 1 ? [MINE] : [] });
      }),
      http.post(BASE, ({ request }) => {
        posted.called = true;
        posted.contentType = request.headers.get('content-type');
        return HttpResponse.json({ data: MINE }, { status: 201 });
      }),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0, applyAccept: false });
    renderList();

    await screen.findByText('添付ファイルはありません。');
    await user.upload(
      screen.getByTestId('attachment-input'),
      new File(['x'], '入稿データ.pdf', { type: 'application/pdf' }),
    );

    await waitFor(() => expect(posted.called).toBe(true));
    expect(posted.contentType).not.toMatch(/application\/json/);
    // 成功したら一覧を取り直す
    expect(await screen.findByText('入稿データ.pdf')).toBeInTheDocument();
  });

  it('添付できない権限のときはアップロードの導線を出さない', async () => {
    stub([MINE]);
    renderList({ canUpload: false });

    await screen.findByText('入稿データ.pdf');
    expect(screen.queryByRole('button', { name: /ファイルを添付/ })).not.toBeInTheDocument();
  });
});
