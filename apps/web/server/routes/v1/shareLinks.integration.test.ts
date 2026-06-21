import { describe, expect, it } from 'vitest';

import { prisma } from '@trakon/db';

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
// share-links ルートの統合テスト (実 DB + ミドルウェアチェーン)
// マウント先: /api/v1/projects/:projectId/share-links
// 一覧はメンバー、発行 (POST) と失効 (DELETE) はディレクター限定。
// 正常系: 一覧 / 発行 / 失効、異常系: 401 / 404 集約 / 422 / SCOPE_NOT_FOUND
// =============================================================================

describe('share-links routes (integration)', () => {
  describe('正常系', () => {
    it('POST /share-links はディレクターが project スコープのリンクを発行し 201 を返す', async () => {
      const { token, project } = await setupProjectWithDirector();

      const res = await api<{
        data: {
          shareLink: { id: string; scopeType: string; status: string };
          rawToken: string;
          url: string;
        };
      }>(`/api/v1/projects/${project.id}/share-links`, {
        method: 'POST',
        token,
        body: { scopeType: 'project', expiresInHours: 168 },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.shareLink.scopeType).toBe('project');
      expect(res.body.data.shareLink.status).toBe('active');
      expect(res.body.data.rawToken).toBeTruthy();
      expect(res.body.data.url).toContain('/share/');
    });

    it('POST /share-links は item スコープで対象 item を指定して発行できる', async () => {
      const { token, project } = await setupProjectWithDirector();
      const item = await createItem({ projectId: project.id });

      const res = await api<{
        data: { shareLink: { scopeType: string; scopeTargetId: string | null } };
      }>(`/api/v1/projects/${project.id}/share-links`, {
        method: 'POST',
        token,
        body: { scopeType: 'item', scopeTargetId: item.id, expiresInHours: 24 },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.shareLink.scopeType).toBe('item');
      expect(res.body.data.shareLink.scopeTargetId).toBe(item.id);
    });

    it('GET /share-links はメンバーに発行済みリンクの一覧を返す', async () => {
      const { token, project, member } = await setupProjectWithDirector();
      // 直接 1 件投入 (ディレクター本人を発行者とする)
      await prisma.shareLink.create({
        data: {
          projectId: project.id,
          scopeType: 'project',
          scopeTargetId: null,
          tokenHash: 'hash-for-list-test',
          issuedByMemberId: member.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const res = await api<{ data: Array<{ id: string; status: string }> }>(
        `/api/v1/projects/${project.id}/share-links`,
        { token },
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]!.status).toBe('active');
    });

    it('DELETE /share-links/:id はディレクターが失効でき 204 を返す', async () => {
      const { token, project, member } = await setupProjectWithDirector();
      const link = await prisma.shareLink.create({
        data: {
          projectId: project.id,
          scopeType: 'project',
          scopeTargetId: null,
          tokenHash: 'hash-for-revoke-test',
          issuedByMemberId: member.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const res = await api(
        `/api/v1/projects/${project.id}/share-links/${link.id}`,
        { method: 'DELETE', token },
      );
      expect(res.status).toBe(204);

      const after = await prisma.shareLink.findUnique({
        where: { id: link.id },
        select: { revokedAt: true },
      });
      expect(after!.revokedAt).not.toBeNull();
    });
  });

  describe('異常系', () => {
    it('未認証は 401 AUTH_MISSING', async () => {
      const { project } = await setupProjectWithDirector();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/share-links`,
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_MISSING');
    });

    it('非メンバーの一覧取得は 404 に集約される', async () => {
      const { project } = await setupProjectWithDirector();
      const { token } = await createOutsider();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/share-links`,
        { token },
      );
      expect(res.status).toBe(404);
    });

    it('ディレクター以外のメンバーによる発行は 404 に集約される', async () => {
      const { project } = await setupProjectWithDirector();
      const member = await createUser();
      await createMember({
        projectId: project.id,
        userId: member.id,
        memberType: 'production',
      });
      const token = await signTestJwt({
        authUserId: member.authUserId,
        email: member.email,
      });
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/share-links`,
        {
          method: 'POST',
          token,
          body: { scopeType: 'project', expiresInHours: 168 },
        },
      );
      expect(res.status).toBe(404);
    });

    it('item スコープで scopeTargetId 欠落の発行は 422', async () => {
      const { token, project } = await setupProjectWithDirector();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/share-links`,
        {
          method: 'POST',
          token,
          body: { scopeType: 'item', expiresInHours: 168 },
        },
      );
      expect(res.status).toBe(422);
    });

    it('別プロジェクトの item を指す発行は 422 SCOPE_NOT_FOUND', async () => {
      const { token, project } = await setupProjectWithDirector();
      // 別プロジェクト配下の item
      const other = await setupProjectWithDirector();
      const foreignItem = await createItem({ projectId: other.project.id });

      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/share-links`,
        {
          method: 'POST',
          token,
          body: {
            scopeType: 'item',
            scopeTargetId: foreignItem.id,
            expiresInHours: 168,
          },
        },
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SCOPE_NOT_FOUND');
    });

    it('存在しない share-link の失効は 404 NOT_FOUND', async () => {
      const { token, project } = await setupProjectWithDirector();
      const res = await api<{ error: { code: string } }>(
        `/api/v1/projects/${project.id}/share-links/${crypto.randomUUID()}`,
        { method: 'DELETE', token },
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
