import { prisma } from '@trakon/db';
import { PROJECT_ROLES, type ProjectRole } from '@trakon/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addProjectMemberWithRole,
  createItem,
  createPlan,
  setupProjectWithDirector,
} from '../../test/factories.js';
import { api } from '../../test/request.js';

// =============================================================================
// ロール別認可の網羅テスト (設計書 §3.4 / §7.12.2)
//
// requireProjectDirector を requireProjectAction へ置き換えた際の**置換漏れ**は、
// 型エラーにならない箇所 (Phase 0 でノーガードだった予定系) が最も危険なので、
// 管理者専用エンドポイントを編集者・閲覧者で叩いて 404 になることを 1 本ずつ確認する。
// =============================================================================

type Ctx = {
  projectId: string;
  itemId: string;
  planId: string;
  tokens: Record<ProjectRole, string>;
};

let ctx: Ctx;

beforeEach(async () => {
  const { project, token: adminToken, member } = await setupProjectWithDirector();
  const item = await createItem({ projectId: project.id });
  const plan = await createPlan({ itemId: item.id, executorMemberId: member.id });
  const editor = await addProjectMemberWithRole({ projectId: project.id, roleType: 'editor' });
  const viewer = await addProjectMemberWithRole({ projectId: project.id, roleType: 'viewer' });

  ctx = {
    projectId: project.id,
    itemId: item.id,
    planId: plan.id,
    tokens: { admin: adminToken, editor: editor.token, viewer: viewer.token },
  };
});

/** 管理者だけが実行できるエンドポイント */
const ADMIN_ONLY: Array<{ name: string; method: 'POST' | 'PATCH' | 'DELETE'; path: (c: Ctx) => string; body?: unknown }> = [
  { name: 'PATCH /projects/:id', method: 'PATCH', path: (c) => `/api/v1/projects/${c.projectId}`, body: { name: '変更後' } },
  { name: 'POST /projects/:id/archive', method: 'POST', path: (c) => `/api/v1/projects/${c.projectId}/archive` },
  { name: 'POST /projects/:id/unarchive', method: 'POST', path: (c) => `/api/v1/projects/${c.projectId}/unarchive` },
  { name: 'POST /items', method: 'POST', path: (c) => `/api/v1/projects/${c.projectId}/items`, body: { name: '新しい制作物' } },
  { name: 'PATCH /items/:itemId', method: 'PATCH', path: (c) => `/api/v1/projects/${c.projectId}/items/${c.itemId}`, body: { name: '変更後' } },
  { name: 'DELETE /items/:itemId', method: 'DELETE', path: (c) => `/api/v1/projects/${c.projectId}/items/${c.itemId}` },
  { name: 'POST /members', method: 'POST', path: (c) => `/api/v1/projects/${c.projectId}/members`, body: { members: [{ name: '新規', organizationName: '', memberType: 'production' }] } },
  { name: 'POST /share-links', method: 'POST', path: (c) => `/api/v1/projects/${c.projectId}/share-links`, body: { scopeType: 'project' } },
];

/** 管理者・編集者が実行でき、閲覧者はできないエンドポイント */
const EDITOR_AND_ABOVE: Array<{ name: string; method: 'POST' | 'PATCH' | 'DELETE'; path: (c: Ctx) => string; body?: unknown }> = [
  {
    name: 'POST /plans',
    method: 'POST',
    path: (c) => `/api/v1/projects/${c.projectId}/items/${c.itemId}/plans`,
    body: { title: '新しい予定', category: 'design', scheduledDate: '2026-06-01' },
  },
  {
    name: 'PATCH /plans/:planId',
    method: 'PATCH',
    path: (c) => `/api/v1/projects/${c.projectId}/items/${c.itemId}/plans/${c.planId}`,
    body: { title: '変更後' },
  },
  {
    name: 'POST /plans/:planId/copy',
    method: 'POST',
    path: (c) => `/api/v1/projects/${c.projectId}/items/${c.itemId}/plans/${c.planId}/copy`,
  },
  {
    name: 'PATCH /plans/:planId/successor',
    method: 'PATCH',
    path: (c) => `/api/v1/projects/${c.projectId}/items/${c.itemId}/plans/${c.planId}/successor`,
    body: { successorPlanId: null },
  },
  {
    name: 'DELETE /plans/:planId',
    method: 'DELETE',
    path: (c) => `/api/v1/projects/${c.projectId}/items/${c.itemId}/plans/${c.planId}`,
  },
];

describe('ロール別認可 — 管理者専用エンドポイント', () => {
  describe('異常系', () => {
    for (const ep of ADMIN_ONLY) {
      it.each(['editor', 'viewer'] as const)(`${ep.name} は %s なら 404 に集約される`, async (role) => {
        const res = await api(ep.path(ctx), {
          method: ep.method,
          token: ctx.tokens[role],
          ...(ep.body ? { body: ep.body } : {}),
        });
        expect(res.status).toBe(404);
      });
    }
  });

  describe('正常系', () => {
    it('管理者は同じエンドポイントを実行できる (404 にならない)', async () => {
      const res = await api(`/api/v1/projects/${ctx.projectId}`, {
        method: 'PATCH',
        token: ctx.tokens.admin,
        body: { name: '変更後' },
      });
      expect(res.status).toBe(200);
    });
  });
});

describe('ロール別認可 — 予定の作成・編集 (Phase 0 はノーガードだった箇所)', () => {
  describe('異常系', () => {
    for (const ep of EDITOR_AND_ABOVE) {
      it(`${ep.name} は閲覧者なら 404 に集約される`, async () => {
        const res = await api(ep.path(ctx), {
          method: ep.method,
          token: ctx.tokens.viewer,
          ...(ep.body ? { body: ep.body } : {}),
        });
        expect(res.status).toBe(404);
      });
    }
  });

  describe('正常系', () => {
    it('編集者は予定を作成できる', async () => {
      const res = await api(`/api/v1/projects/${ctx.projectId}/items/${ctx.itemId}/plans`, {
        method: 'POST',
        token: ctx.tokens.editor,
        body: { title: '編集者の予定', category: 'design', scheduledDate: '2026-06-01' },
      });
      expect(res.status).toBe(201);
    });
  });
});

describe('ロール別認可 — 閲覧は全ロールに許可される', () => {
  it.each([...PROJECT_ROLES])('%s はプロジェクト詳細を取得できる', async (role) => {
    const res = await api(`/api/v1/projects/${ctx.projectId}`, { token: ctx.tokens[role] });
    expect(res.status).toBe(200);
  });

  it.each([...PROJECT_ROLES])('%s は参加者一覧を取得できる', async (role) => {
    const res = await api(`/api/v1/projects/${ctx.projectId}/members`, { token: ctx.tokens[role] });
    expect(res.status).toBe(200);
  });
});

describe('プロジェクトロールの解決', () => {
  it('作成者は role_type を viewer に落としても管理者として扱われる (FR-ROLE-04)', async () => {
    await prisma.projectMember.updateMany({
      where: { projectId: ctx.projectId, roleType: 'admin' },
      data: { roleType: 'viewer' },
    });

    const res = await api<{ data: { role: ProjectRole } }>(`/api/v1/projects/${ctx.projectId}`, {
      token: ctx.tokens.admin,
    });

    expect(res.body.data.role).toBe('admin');
    // 実際に管理者専用の操作も通る
    const patched = await api(`/api/v1/projects/${ctx.projectId}`, {
      method: 'PATCH',
      token: ctx.tokens.admin,
      body: { name: '締め出されない' },
    });
    expect(patched.status).toBe(200);
  });

  it('参加者の role_type がそのままロールになる', async () => {
    const res = await api<{ data: { role: ProjectRole } }>(`/api/v1/projects/${ctx.projectId}`, {
      token: ctx.tokens.viewer,
    });
    expect(res.body.data.role).toBe('viewer');
  });
});

describe('最後の管理者を 0 名にはできない (FR-ROLE-03)', () => {
  it('最後の管理者を降格しようとすると 409 LAST_ADMIN', async () => {
    // 作成者は常に管理者なので、作成者の member 行を消してから検証する
    const { project, token } = await setupProjectWithDirector();
    const admin = await addProjectMemberWithRole({ projectId: project.id, roleType: 'admin' });
    await prisma.projectMember.deleteMany({
      where: { projectId: project.id, userId: { not: admin.user.id } },
    });

    const res = await api<{ error: { code: string } }>(
      `/api/v1/projects/${project.id}/members/${admin.member.id}`,
      { method: 'PATCH', token: admin.token, body: { roleType: 'editor' } },
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
    expect(token).toBeTruthy();
  });

  it('他に管理者がいれば降格できる', async () => {
    const { project } = await setupProjectWithDirector();
    const target = await addProjectMemberWithRole({ projectId: project.id, roleType: 'admin' });

    const res = await api(`/api/v1/projects/${project.id}/members/${target.member.id}`, {
      method: 'PATCH',
      token: target.token,
      body: { roleType: 'editor' },
    });

    expect(res.status).toBe(200);
  });
});
