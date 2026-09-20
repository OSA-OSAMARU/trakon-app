import { prisma } from '@trakon/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../test/request.js';
import {
  addProjectMemberWithRole,
  createItem,
  createPlan,
  setupProjectWithDirector,
} from '../../test/factories.js';

// =============================================================================
// 予定への添付ファイル (#65) の統合テスト (実 DB + ミドルウェアチェーン)
// マウント先: /api/v1/projects/:projectId/items/:itemId/plans/:planId/attachments
//
// Storage は差し替える。ここで確かめるのは認可・件数上限・削除権限といった
// アプリ側の責務で、Supabase への往復ではない。
// =============================================================================

const uploaded: string[] = [];
const removed: string[] = [];

vi.mock('../../lib/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: async (key: string) => {
          uploaded.push(key);
          return { error: null };
        },
        remove: async (keys: string[]) => {
          removed.push(...keys);
          return { error: null };
        },
        createSignedUrl: async (key: string) => ({
          data: { signedUrl: `https://signed.test/${key}` },
          error: null,
        }),
      }),
    },
  }),
}));

type AttachmentDTO = {
  id: string;
  filename: string;
  sizeBytes: number;
  uploader: { id: string; name: string } | null;
  downloadUrl: string | null;
};

let ctx: Awaited<ReturnType<typeof setupProjectWithDirector>>;
let base: string;
let planId: string;

function upload(token: string, filename: string, content = 'x') {
  const form = new FormData();
  form.append('file', new File([content], filename, { type: 'application/pdf' }));
  return api<{ data: AttachmentDTO; error?: { code: string } }>(base, {
    method: 'POST',
    token,
    body: form,
  });
}

beforeEach(async () => {
  uploaded.length = 0;
  removed.length = 0;
  ctx = await setupProjectWithDirector();
  const item = await createItem({ projectId: ctx.project.id, name: 'トップページ' });
  const plan = await createPlan({ itemId: item.id, title: 'デザイン' });
  planId = plan.id;
  base = `/api/v1/projects/${ctx.project.id}/items/${item.id}/plans/${planId}/attachments`;
});

describe('attachments routes (integration)', () => {
  describe('正常系', () => {
    it('POST で添付でき、署名付き URL を返す', async () => {
      const res = await upload(ctx.token, '入稿データ.pdf');

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        filename: '入稿データ.pdf',
        uploader: { id: ctx.member.id },
      });
      // 直リンクは返さない
      expect(res.body.data.downloadUrl).toContain('https://signed.test/');
      expect(uploaded).toHaveLength(1);
      // オブジェクトキーはプロジェクト / 予定でプレフィックスを切る
      expect(uploaded[0]).toMatch(new RegExp(`^${ctx.project.id}/${planId}/`));
    });

    it('GET は追加した順に返す', async () => {
      await upload(ctx.token, '1.pdf');
      await upload(ctx.token, '2.pdf');

      const res = await api<{ data: AttachmentDTO[] }>(base, { token: ctx.token });

      expect(res.status).toBe(200);
      expect(res.body.data.map((a) => a.filename)).toEqual(['1.pdf', '2.pdf']);
    });

    it('DELETE すると一覧から消え、Storage の実体も消える', async () => {
      const created = await upload(ctx.token, '消す.pdf');

      const res = await api(`${base}/${created.body.data.id}`, {
        method: 'DELETE',
        token: ctx.token,
      });
      expect(res.status).toBe(204);

      const after = await api<{ data: AttachmentDTO[] }>(base, { token: ctx.token });
      expect(after.body.data).toHaveLength(0);
      expect(removed).toHaveLength(1);

      // 台帳は論理削除で残す (いつ誰が消したかを答えられるように)
      const row = await prisma.attachment.findFirst({
        where: { id: created.body.data.id },
        select: { deletedAt: true },
      });
      expect(row!.deletedAt).not.toBeNull();
    });

    it('閲覧者も添付できる (支給素材はクライアント側から来る)', async () => {
      const viewer = await addProjectMemberWithRole({
        projectId: ctx.project.id,
        roleType: 'viewer',
      });

      const res = await upload(viewer.token, '支給素材.pdf');

      expect(res.status).toBe(201);
    });
  });

  describe('異常系', () => {
    it('未認証は 401', async () => {
      const form = new FormData();
      form.append('file', new File(['x'], 'a.pdf'));
      const res = await api(base, { method: 'POST', body: form });
      expect(res.status).toBe(401);
    });

    it('実行ファイルは 422 で弾き、Storage にも置かない', async () => {
      const res = await upload(ctx.token, 'setup.exe');

      expect(res.status).toBe(422);
      expect(res.body.error!.code).toBe('ATTACHMENT_UNSUPPORTED_TYPE');
      expect(uploaded).toHaveLength(0);
    });

    it('ファイルが無ければ 422', async () => {
      const res = await api<{ error: { code: string } }>(base, {
        method: 'POST',
        token: ctx.token,
        body: new FormData(),
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ATTACHMENT_MISSING');
    });

    it('他人の添付は削除できない (403)', async () => {
      const editor = await addProjectMemberWithRole({
        projectId: ctx.project.id,
        roleType: 'editor',
      });
      const created = await upload(editor.token, '他人のファイル.pdf');
      removed.length = 0;

      const other = await addProjectMemberWithRole({
        projectId: ctx.project.id,
        roleType: 'editor',
      });
      const res = await api<{ error: { code: string } }>(
        `${base}/${created.body.data.id}`,
        { method: 'DELETE', token: other.token },
      );

      expect(res.status).toBe(403);
      expect(removed).toHaveLength(0);
    });

    it('管理者は他人の添付も削除できる', async () => {
      const editor = await addProjectMemberWithRole({
        projectId: ctx.project.id,
        roleType: 'editor',
      });
      const created = await upload(editor.token, '他人のファイル.pdf');

      const res = await api(`${base}/${created.body.data.id}`, {
        method: 'DELETE',
        token: ctx.token,
      });

      expect(res.status).toBe(204);
    });

    it('非メンバーは 404 に集約される', async () => {
      const outsider = await setupProjectWithDirector();
      const res = await api(base, { token: outsider.token });
      expect(res.status).toBe(404);
    });
  });
});
