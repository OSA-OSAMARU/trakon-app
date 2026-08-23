import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/handlers';

// supabase はモックして getSession を制御する (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { supabase } from '@/lib/supabase';
import { projectsApi } from './api';
import type { ProjectSummary, ProjectDetail, ProjectItem, CreateProjectInput } from './api';

const getSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } });
});

const stubSummary: ProjectSummary = {
  id: 'proj-1',
  name: 'プロジェクト',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  status: 'active',
  archivedAt: null,
  role: 'director',
  clientName: null,
  progressManager: null,
  overdueCount: 0,
  createdBy: 'u-1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const stubDetail: ProjectDetail = {
  ...stubSummary,
  counts: { memberCount: 1, itemCount: 2 },
};

const stubItem: ProjectItem = {
  id: 'item-1',
  projectId: 'proj-1',
  name: '制作物',
  sortOrder: 0,
  startDate: null,
  endDate: null,
  counts: { activePlanCount: 0, completedPlanCount: 0 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('projectsApi', () => {
  it('list: archived 未指定では query なし', async () => {
    let url = '';
    server.use(
      http.get('*/api/v1/projects', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: [stubSummary] });
      }),
    );
    const res = await projectsApi.list();
    expect(res).toEqual([stubSummary]);
    expect(url).not.toContain('?');
  });

  it('list: archived=true で query を付ける', async () => {
    let url = '';
    server.use(
      http.get('*/api/v1/projects', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: [] });
      }),
    );
    await projectsApi.list({ archived: true });
    expect(new URL(url).searchParams.get('archived')).toBe('true');
  });

  it('list: archived=false では query なし', async () => {
    let url = '';
    server.use(
      http.get('*/api/v1/projects', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: [] });
      }),
    );
    await projectsApi.list({ archived: false });
    expect(url).not.toContain('?');
  });

  it('get: 詳細を取得する', async () => {
    server.use(
      http.get('*/api/v1/projects/proj-1', () => HttpResponse.json({ data: stubDetail })),
    );
    const res = await projectsApi.get('proj-1');
    expect(res).toEqual(stubDetail);
  });

  it('create: POST で body を送る', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.post('*/api/v1/projects', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ data: stubDetail });
      }),
    );
    const input: CreateProjectInput = {
      name: 'P',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      items: [{ name: 'i' }],
      members: [],
    };
    const res = await projectsApi.create(input);
    expect(res).toEqual(stubDetail);
    expect(method).toBe('POST');
    expect(body).toEqual(input);
  });

  it('update: PATCH で body を送る', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.patch('*/api/v1/projects/proj-1', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ data: stubDetail });
      }),
    );
    await projectsApi.update('proj-1', { name: '新名称' });
    expect(method).toBe('PATCH');
    expect(body).toEqual({ name: '新名称' });
  });

  it('archive: POST する', async () => {
    let method = '';
    server.use(
      http.post('*/api/v1/projects/proj-1/archive', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ data: stubDetail });
      }),
    );
    const res = await projectsApi.archive('proj-1');
    expect(res).toEqual(stubDetail);
    expect(method).toBe('POST');
  });

  it('unarchive: POST する', async () => {
    server.use(
      http.post('*/api/v1/projects/proj-1/unarchive', () =>
        HttpResponse.json({ data: stubDetail }),
      ),
    );
    const res = await projectsApi.unarchive('proj-1');
    expect(res).toEqual(stubDetail);
  });

  it('listItems: 制作物一覧を取得する', async () => {
    server.use(
      http.get('*/api/v1/projects/proj-1/items', () =>
        HttpResponse.json({ data: [stubItem] }),
      ),
    );
    const res = await projectsApi.listItems('proj-1');
    expect(res).toEqual([stubItem]);
  });

  it('createItem: POST で body を送る', async () => {
    let body: unknown = null;
    server.use(
      http.post('*/api/v1/projects/proj-1/items', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: stubItem });
      }),
    );
    await projectsApi.createItem('proj-1', { name: '新制作物', sortOrder: 1 });
    expect(body).toEqual({ name: '新制作物', sortOrder: 1 });
  });

  it('updateItem: PATCH で body を送る', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.patch('*/api/v1/projects/proj-1/items/item-1', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ data: stubItem });
      }),
    );
    await projectsApi.updateItem('proj-1', 'item-1', { name: '改名' });
    expect(method).toBe('PATCH');
    expect(body).toEqual({ name: '改名' });
  });

  it('deleteItem: DELETE で 204 を扱う', async () => {
    let method = '';
    server.use(
      http.delete('*/api/v1/projects/proj-1/items/item-1', ({ request }) => {
        method = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const res = await projectsApi.deleteItem('proj-1', 'item-1');
    expect(res).toBeUndefined();
    expect(method).toBe('DELETE');
  });

  it('エラー応答時は reject する', async () => {
    server.use(
      http.get('*/api/v1/projects/proj-1', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: '見つかりません' } },
          { status: 404 },
        ),
      ),
    );
    await expect(projectsApi.get('proj-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});
