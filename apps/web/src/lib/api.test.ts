import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/handlers';

// supabase はモックして getSession を制御する (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { supabase } from '@/lib/supabase';
import { apiRequest, ApiClientError } from '@/lib/api';

const getSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } });
});

describe('apiRequest', () => {
  it('成功時は {data} をアンラップして返す', async () => {
    server.use(
      http.get('*/api/v1/ping', () => HttpResponse.json({ data: { ok: true } })),
    );
    const res = await apiRequest<{ ok: boolean }>('/ping');
    expect(res).toEqual({ ok: true });
  });

  it('204 No Content は undefined を返す', async () => {
    server.use(
      http.delete('*/api/v1/things/1', () => new HttpResponse(null, { status: 204 })),
    );
    const res = await apiRequest<void>('/things/1', { method: 'DELETE' });
    expect(res).toBeUndefined();
  });

  it('エラー応答は ApiClientError として code/status を投げる', async () => {
    server.use(
      http.get('*/api/v1/boom', () =>
        HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: 'bad' } },
          { status: 422 },
        ),
      ),
    );
    await expect(apiRequest('/boom')).rejects.toMatchObject({
      code: 'UNPROCESSABLE_ENTITY',
      status: 422,
    });
    await expect(apiRequest('/boom')).rejects.toBeInstanceOf(ApiClientError);
  });

  it('セッションがあれば Authorization ヘッダを注入する', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } });
    let received: string | null = null;
    server.use(
      http.get('*/api/v1/me', ({ request }) => {
        received = request.headers.get('authorization');
        return HttpResponse.json({ data: { id: 'u1' } });
      }),
    );
    await apiRequest('/me');
    expect(received).toBe('Bearer tok-123');
  });
});
