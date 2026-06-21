import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/handlers';

// supabase はモックして getSession を制御する (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { supabase } from '@/lib/supabase';
import { shareLinksApi, shareAccessApi } from './api';
import type { ShareLink, CreateShareLinkResult, ShareView } from './api';

const getSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } });
});

const stubLink: ShareLink = {
  id: 'sl-1',
  projectId: 'proj-1',
  scopeType: 'project',
  scopeTargetId: null,
  issuedByMemberId: 'm-1',
  issuedAt: '2026-01-01T00:00:00Z',
  expiresAt: null,
  revokedAt: null,
  lastAccessedAt: null,
  status: 'active',
};

describe('shareLinksApi', () => {
  it('list: 共有リンク一覧を取得する', async () => {
    server.use(
      http.get('*/api/v1/projects/proj-1/share-links', () =>
        HttpResponse.json({ data: [stubLink] }),
      ),
    );
    const res = await shareLinksApi.list('proj-1');
    expect(res).toEqual([stubLink]);
  });

  it('create: POST で body を送り結果を返す', async () => {
    let method = '';
    let body: unknown = null;
    const result: CreateShareLinkResult = {
      shareLink: stubLink,
      rawToken: 'raw-tok',
      url: 'https://example.com/share/raw-tok',
    };
    server.use(
      http.post('*/api/v1/projects/proj-1/share-links', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ data: result });
      }),
    );
    const input = { scopeType: 'project' as const, expiresInHours: null };
    const res = await shareLinksApi.create('proj-1', input);
    expect(res).toEqual(result);
    expect(method).toBe('POST');
    expect(body).toEqual(input);
  });

  it('revoke: DELETE で 204 を扱う', async () => {
    let method = '';
    server.use(
      http.delete('*/api/v1/projects/proj-1/share-links/sl-1', ({ request }) => {
        method = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const res = await shareLinksApi.revoke('proj-1', 'sl-1');
    expect(res).toBeUndefined();
    expect(method).toBe('DELETE');
  });

  it('エラー応答時は reject する', async () => {
    server.use(
      http.get('*/api/v1/projects/proj-1/share-links', () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: '権限なし' } },
          { status: 403 },
        ),
      ),
    );
    await expect(shareLinksApi.list('proj-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });
});

describe('shareAccessApi', () => {
  it('view: token を URL エンコードして取得する', async () => {
    let url = '';
    const view: ShareView = {
      share: { id: 'sl-1', scopeType: 'project', scopeTargetId: null, expiresAt: null },
      project: { id: 'proj-1', name: 'P', startDate: '2026-01-01', endDate: '2026-12-31' },
      items: [],
      plans: [],
    };
    server.use(
      http.get('*/api/v1/share/:token', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: view });
      }),
    );
    // 特殊文字を含む token がエンコードされることを確認。
    const res = await shareAccessApi.view('a/b c');
    expect(res).toEqual(view);
    expect(url).toContain('/share/a%2Fb%20c');
  });

  it('view: エラー応答時は reject する', async () => {
    server.use(
      http.get('*/api/v1/share/:token', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: '無効なリンク' } },
          { status: 404 },
        ),
      ),
    );
    await expect(shareAccessApi.view('tok')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});
