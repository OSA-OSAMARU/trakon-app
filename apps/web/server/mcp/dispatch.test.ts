import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { requireAuth } from '../middleware/auth.js';
import { createDispatcher } from './dispatch.js';
import { getInternalPrincipal } from './internalPrincipal.js';

const planFindFirst = vi.fn();
vi.mock('@trakon/db', () => ({ prisma: { plan: { findFirst: planFindFirst } } }));

const USER = { authUserId: 'au1', email: 'u@example.test' };

beforeAll(() => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-1234567890';
});

describe('createDispatcher', () => {
  it('同じオリジンの /api/v1 へ、本人を登録した Request で JSON を送る', async () => {
    const fetch = vi.fn(async (req: Request) => {
      expect(req.url).toBe('https://t.example/api/v1/projects/p/items');
      expect(req.method).toBe('POST');
      expect(req.headers.get('content-type')).toBe('application/json');
      expect(await req.json()).toEqual({ name: 'LP' });
      expect(getInternalPrincipal(req)).toEqual(USER);
      return Response.json(
        { data: { id: 'i1' }, meta: { total: 1 }, warnings: ['w'] },
        { status: 201 },
      );
    });
    const dispatch = createDispatcher({ fetch, origin: 'https://t.example', user: USER });
    expect(await dispatch('POST', '/projects/p/items', { name: 'LP' })).toEqual({
      ok: true,
      status: 201,
      data: { id: 'i1' },
      meta: { total: 1 },
      warnings: ['w'],
    });
  });

  it('body が無ければ content-type を付けない。204 は data なし', async () => {
    const fetch = vi.fn(async (req: Request) => {
      expect(req.headers.get('content-type')).toBeNull();
      return new Response(null, { status: 204 });
    });
    const dispatch = createDispatcher({ fetch, origin: 'https://t.example', user: USER });
    expect(await dispatch('DELETE', '/x')).toEqual({ ok: true, status: 204, data: undefined });
  });

  it('エラーの封筒をそのまま失敗として返す', async () => {
    const dispatch = createDispatcher({
      fetch: async () =>
        Response.json(
          { error: { code: 'NOT_FOUND', message: 'nope', details: 1 } },
          { status: 404 },
        ),
      origin: 'https://t.example',
      user: USER,
    });
    expect(await dispatch('GET', '/x')).toEqual({
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'nope',
      details: 1,
    });
  });

  it('JSON でない失敗も失敗として扱う', async () => {
    const dispatch = createDispatcher({
      fetch: async () => new Response('Bad Gateway', { status: 502 }),
      origin: 'https://t.example',
      user: USER,
    });
    expect(await dispatch('GET', '/x')).toMatchObject({
      ok: false,
      status: 502,
      code: 'HTTP_502',
    });
  });

  it('成功で本文が空でも落ちない', async () => {
    const dispatch = createDispatcher({
      fetch: async () => new Response('', { status: 200 }),
      origin: 'https://t.example',
      user: USER,
    });
    expect(await dispatch('GET', '/x')).toEqual({ ok: true, status: 200, data: undefined });
  });
});

describe('requireAuth の内部経路', () => {
  const app = new Hono().get('/api/v1/me', requireAuth(), (c) =>
    c.json({ data: c.get('authUser') }),
  );

  it('登録済みの Request だけ JWT 検証を省いて本人を採用する', async () => {
    const dispatch = createDispatcher({
      fetch: (req) => app.fetch(req),
      origin: 'https://t.example',
      user: USER,
    });
    expect(await dispatch('GET', '/me')).toEqual({ ok: true, status: 200, data: USER });
  });

  it('作り直した Request (別オブジェクト) は内部経路に入れない', async () => {
    const dispatch = createDispatcher({
      fetch: (req) => app.fetch(new Request(req.url, req)),
      origin: 'https://t.example',
      user: USER,
    });
    expect(await dispatch('GET', '/me')).toMatchObject({ ok: false, status: 401 });
  });

  it('外部からの Request は同じヘッダでも内部経路に入れない', async () => {
    const res = await app.request('/api/v1/me', { headers: { authorization: 'Bearer trk_at_x' } });
    expect(res.status).toBe(401);
  });
});

describe('resolvePlanItemId', () => {
  it('projectId 配下の削除されていない予定から itemId を引く', async () => {
    const { resolvePlanItemId } = await import('./resolvePlanItemId.js');
    planFindFirst.mockResolvedValueOnce({ itemId: 'i1' }).mockResolvedValueOnce(null);
    expect(await resolvePlanItemId('p1', 'pl1')).toBe('i1');
    expect(planFindFirst).toHaveBeenCalledWith({
      where: { id: 'pl1', deletedAt: null, item: { projectId: 'p1', deletedAt: null } },
      select: { itemId: true },
    });
    expect(await resolvePlanItemId('p1', 'pl2')).toBeNull();
  });
});
