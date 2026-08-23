import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/handlers';

// supabase はモックして getSession を制御する (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { supabase } from '@/lib/supabase';
import { membersApi } from './membersApi';
import type { ProjectMember, AddMembersInput } from './membersApi';

const getSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: null } });
});

const stubMember: ProjectMember = {
  id: 'm-1',
  userId: null,
  name: '田中',
  email: 'tanaka@example.com',
  organizationName: '株式会社A',
  memberType: 'production',
  jobTitle: null,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('membersApi', () => {
  it('list: メンバー一覧を取得する', async () => {
    server.use(
      http.get('*/api/v1/projects/proj-1/members', () =>
        HttpResponse.json({ data: [stubMember] }),
      ),
    );
    const res = await membersApi.list('proj-1');
    expect(res).toEqual([stubMember]);
  });

  it('add: POST で body を送る', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.post('*/api/v1/projects/proj-1/members', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ data: [stubMember] });
      }),
    );
    const input: AddMembersInput = {
      members: [
        {
          name: '田中',
          email: 'tanaka@example.com',
          organizationName: '株式会社A',
          memberType: 'production',
          jobTitle: null,
        },
      ],
    };
    const res = await membersApi.add('proj-1', input);
    expect(res).toEqual([stubMember]);
    expect(method).toBe('POST');
    expect(body).toEqual(input);
  });

  it('update: PATCH で body を送る', async () => {
    let method = '';
    let body: unknown = null;
    server.use(
      http.patch('*/api/v1/projects/proj-1/members/m-1', async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ data: stubMember });
      }),
    );
    await membersApi.update('proj-1', 'm-1', { name: '佐藤' });
    expect(method).toBe('PATCH');
    expect(body).toEqual({ name: '佐藤' });
  });

  it('remove: DELETE で 204 を扱う', async () => {
    let method = '';
    server.use(
      http.delete('*/api/v1/projects/proj-1/members/m-1', ({ request }) => {
        method = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const res = await membersApi.remove('proj-1', 'm-1');
    expect(res).toBeUndefined();
    expect(method).toBe('DELETE');
  });

  it('エラー応答時は reject する', async () => {
    server.use(
      http.get('*/api/v1/projects/proj-1/members', () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: '権限なし' } },
          { status: 403 },
        ),
      ),
    );
    await expect(membersApi.list('proj-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });
});
