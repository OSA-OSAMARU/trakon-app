import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../../test/request.js';
import {
  createItem,
  createMember,
  createOutsider,
  createUser,
  setupProjectWithDirector,
} from '../../test/factories.js';
import { signTestJwt } from '../../test/auth.js';

// =============================================================================
// project items ルートの統合テスト (実 DB + ミドルウェアチェーン)
// /api/v1/projects/:projectId/items
// 正常系: 一覧 / 作成 / 詳細 / 更新 / 削除
// 異常系: 401 / 非メンバー 404 集約 / 非ディレクター 404 集約 / 422 / 最後の1件削除不可
// =============================================================================

type ItemDTO = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
};

describe('items routes (integration)', () => {
  let ctx: Awaited<ReturnType<typeof setupProjectWithDirector>>;
  let base: string;

  beforeEach(async () => {
    ctx = await setupProjectWithDirector();
    base = `/api/v1/projects/${ctx.project.id}/items`;
  });

  describe('正常系', () => {
    it('GET /items はプロジェクトの制作物を sortOrder 昇順で返す', async () => {
      await createItem({ projectId: ctx.project.id, name: 'B', sortOrder: 1 });
      await createItem({ projectId: ctx.project.id, name: 'A', sortOrder: 0 });

      const res = await api<{ data: ItemDTO[] }>(base, { token: ctx.token });
      expect(res.status).toBe(200);
      expect(res.body.data.map((i) => i.name)).toEqual(['A', 'B']);
    });

    it('POST /items はディレクターが制作物を作成し 201 を返す', async () => {
      const res = await api<{ data: ItemDTO }>(base, {
        method: 'POST',
        token: ctx.token,
        body: { name: 'LP' },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('LP');
      expect(res.body.data.projectId).toBe(ctx.project.id);
    });

    it('GET /items/:itemId はメンバーに詳細を返す', async () => {
      const item = await createItem({ projectId: ctx.project.id, name: 'OGP' });
      const res = await api<{ data: ItemDTO }>(`${base}/${item.id}`, {
        token: ctx.token,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(item.id);
      expect(res.body.data.name).toBe('OGP');
    });

    it('PATCH /items/:itemId はディレクターが名前を更新できる', async () => {
      const item = await createItem({ projectId: ctx.project.id, name: 'old' });
      const res = await api<{ data: ItemDTO }>(`${base}/${item.id}`, {
        method: 'PATCH',
        token: ctx.token,
        body: { name: 'new' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('new');
    });

    it('POST /items/reorder はディレクターが並び替えでき、新しい順序を返す (#111)', async () => {
      const a = await createItem({ projectId: ctx.project.id, name: 'A', sortOrder: 0 });
      const b = await createItem({ projectId: ctx.project.id, name: 'B', sortOrder: 1 });
      const c = await createItem({ projectId: ctx.project.id, name: 'C', sortOrder: 2 });

      const res = await api<{ data: ItemDTO[] }>(`${base}/reorder`, {
        method: 'POST',
        token: ctx.token,
        body: { orderedIds: [c.id, a.id, b.id] },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
      expect(res.body.data.map((i) => i.sortOrder)).toEqual([0, 1, 2]);

      // 永続化を GET で確認 (/reorder が /:itemId より優先されている確認も兼ねる)
      const after = await api<{ data: ItemDTO[] }>(base, { token: ctx.token });
      expect(after.body.data.map((i) => i.name)).toEqual(['C', 'A', 'B']);
    });

    it('POST /items/reorder は id が過不足あると 422 INVALID_REORDER', async () => {
      const a = await createItem({ projectId: ctx.project.id, name: 'A', sortOrder: 0 });
      await createItem({ projectId: ctx.project.id, name: 'B', sortOrder: 1 });

      const res = await api<{ error: { code: string } }>(`${base}/reorder`, {
        method: 'POST',
        token: ctx.token,
        body: { orderedIds: [a.id] }, // B が欠けている
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_REORDER');
    });

    it('DELETE /items/:itemId は 2 件以上ある場合にディレクターが削除でき 204 を返す', async () => {
      const a = await createItem({ projectId: ctx.project.id, name: 'A', sortOrder: 0 });
      await createItem({ projectId: ctx.project.id, name: 'B', sortOrder: 1 });

      const res = await api(`${base}/${a.id}`, { method: 'DELETE', token: ctx.token });
      expect(res.status).toBe(204);

      const after = await api<{ data: ItemDTO[] }>(base, { token: ctx.token });
      expect(after.body.data.map((i) => i.id)).not.toContain(a.id);
    });
  });

  describe('異常系', () => {
    it('未認証の一覧取得は 401 AUTH_MISSING', async () => {
      const res = await api<{ error: { code: string } }>(base);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_MISSING');
    });

    it('非メンバーの一覧取得は 404 に集約される', async () => {
      const { token } = await createOutsider();
      const res = await api<{ error: { code: string } }>(base, { token });
      expect(res.status).toBe(404);
    });

    it('ディレクター以外のメンバーによる作成は 404 に集約される', async () => {
      // createdBy ではない production メンバー (= 非ディレクター)
      const member = await createUser();
      await createMember({
        projectId: ctx.project.id,
        userId: member.id,
        memberType: 'production',
      });
      const token = await signTestJwt({
        authUserId: member.authUserId,
        email: member.email,
      });

      const res = await api<{ error: { code: string } }>(base, {
        method: 'POST',
        token,
        body: { name: 'hijacked' },
      });
      expect(res.status).toBe(404);
    });

    it('name が空の作成リクエストは 422', async () => {
      const res = await api<{ error: { code: string } }>(base, {
        method: 'POST',
        token: ctx.token,
        body: { name: '' },
      });
      expect(res.status).toBe(422);
    });

    it('存在しない制作物の詳細取得は 404 NOT_FOUND', async () => {
      const res = await api<{ error: { code: string } }>(
        `${base}/${crypto.randomUUID()}`,
        { token: ctx.token },
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('最後の 1 件の削除は 409 LAST_ITEM_CANNOT_BE_DELETED', async () => {
      const only = await createItem({ projectId: ctx.project.id, name: 'only' });
      const res = await api<{ error: { code: string } }>(`${base}/${only.id}`, {
        method: 'DELETE',
        token: ctx.token,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_ITEM_CANNOT_BE_DELETED');
    });
  });
});
