import { describe, expect, it } from 'vitest';

import { api } from '../../test/request.js';
import { createMember, createUser, setupProjectWithDirector } from '../../test/factories.js';
import { signTestJwt } from '../../test/auth.js';

// =============================================================================
// プロフィール項目 (所属名 / 職種 / 通知先メール) の統合テスト (#156)
//
// これらは users 側を正とし、参加者一覧の DTO には read-through で反映される
// (packages/shared/src/domain/memberProfile.ts)。アカウント未紐付けの
// 「表示されるだけのメンバー」は参加者行の値がそのまま使われる。
// =============================================================================

async function tokenFor(user: { authUserId: string; email: string }) {
  return signTestJwt({ authUserId: user.authUserId, email: user.email });
}

type MeBody = {
  data: {
    email: string;
    organizationName: string | null;
    jobTitle: string | null;
    notificationEmail: string | null;
    effectiveNotificationEmail: string;
    avatarPath: string | null;
  };
};

describe('プロフィール項目 (#156)', () => {
  describe('GET /auth/me', () => {
    it('未設定なら null を返し、通知先はログイン用メールにフォールバックする', async () => {
      const user = await createUser({ email: 'login@example.test' });
      const res = await api<MeBody>('/api/v1/auth/me', { token: await tokenFor(user) });

      expect(res.status).toBe(200);
      expect(res.body.data.organizationName).toBeNull();
      expect(res.body.data.jobTitle).toBeNull();
      expect(res.body.data.notificationEmail).toBeNull();
      expect(res.body.data.effectiveNotificationEmail).toBe('login@example.test');
      expect(res.body.data.avatarPath).toBeNull();
    });

    it('通知先メールを設定するとそちらが実効値になる', async () => {
      const user = await createUser({
        email: 'login@example.test',
        notificationEmail: 'notify@example.test',
      });
      const res = await api<MeBody>('/api/v1/auth/me', { token: await tokenFor(user) });

      expect(res.body.data.notificationEmail).toBe('notify@example.test');
      expect(res.body.data.effectiveNotificationEmail).toBe('notify@example.test');
    });
  });

  describe('PATCH /auth/me', () => {
    it('所属名 / 職種 / 通知先メールを保存できる', async () => {
      const user = await createUser();
      const res = await api<MeBody>('/api/v1/auth/me', {
        method: 'PATCH',
        token: await tokenFor(user),
        body: {
          organizationName: 'おさまるカンパニー',
          jobTitle: 'director',
          notificationEmail: 'Notify@Example.test',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.data.organizationName).toBe('おさまるカンパニー');
      expect(res.body.data.jobTitle).toBe('director');
      // メールは小文字へ正規化される
      expect(res.body.data.notificationEmail).toBe('notify@example.test');
    });

    it('空文字を送ると未設定に戻る (通知先はログイン用メールへ)', async () => {
      const user = await createUser({
        email: 'login@example.test',
        organizationName: '旧所属',
        jobTitle: 'designer',
        notificationEmail: 'old@example.test',
      });
      const res = await api<MeBody>('/api/v1/auth/me', {
        method: 'PATCH',
        token: await tokenFor(user),
        body: { organizationName: '', jobTitle: '', notificationEmail: '' },
      });

      expect(res.status).toBe(200);
      expect(res.body.data.organizationName).toBeNull();
      expect(res.body.data.jobTitle).toBeNull();
      expect(res.body.data.notificationEmail).toBeNull();
      expect(res.body.data.effectiveNotificationEmail).toBe('login@example.test');
    });

    it('職種マスタに無い値は 422', async () => {
      const user = await createUser();
      const res = await api<{ error: { code: string } }>('/api/v1/auth/me', {
        method: 'PATCH',
        token: await tokenFor(user),
        body: { jobTitle: 'ninja' },
      });
      expect(res.status).toBe(422);
    });

    it('不正な形式の通知先メールは 422', async () => {
      const user = await createUser();
      const res = await api<{ error: { code: string } }>('/api/v1/auth/me', {
        method: 'PATCH',
        token: await tokenFor(user),
        body: { notificationEmail: 'not-an-email' },
      });
      expect(res.status).toBe(422);
    });
  });

  describe('参加者一覧への read-through', () => {
    type MembersBody = {
      data: Array<{
        userId: string | null;
        name: string;
        email: string | null;
        organizationName: string;
        jobTitle: string | null;
      }>;
    };

    it('アカウント紐付け済みの参加者は users の所属名・職種・通知先メールで返る', async () => {
      const { project, token, user } = await setupProjectWithDirector();
      await api('/api/v1/auth/me', {
        method: 'PATCH',
        token,
        body: {
          organizationName: 'おさまるカンパニー',
          jobTitle: 'director',
          notificationEmail: 'notify@example.test',
        },
      });

      const res = await api<MembersBody>(`/api/v1/projects/${project.id}/members`, { token });
      const me = res.body.data.find((m) => m.userId === user.id);

      expect(me?.organizationName).toBe('おさまるカンパニー');
      expect(me?.jobTitle).toBe('director');
      expect(me?.email).toBe('notify@example.test');
    });

    it('アカウント未紐付けの表示専用メンバーは参加者行の値のまま', async () => {
      const { project, token } = await setupProjectWithDirector();
      await createMember({
        projectId: project.id,
        userId: null,
        name: '石原 美咲',
        email: 'misaki@example.test',
        organizationName: '青庭不動産',
        jobTitle: 'marketer',
      });

      const res = await api<MembersBody>(`/api/v1/projects/${project.id}/members`, { token });
      const guest = res.body.data.find((m) => m.name === '石原 美咲');

      expect(guest?.userId).toBeNull();
      expect(guest?.organizationName).toBe('青庭不動産');
      expect(guest?.jobTitle).toBe('marketer');
      expect(guest?.email).toBe('misaki@example.test');
    });

    it('参加者行に所属名・職種が入っていればプロジェクト別の上書きとして優先される', async () => {
      const owner = await createUser({
        organizationName: 'アカウント側の所属',
        jobTitle: 'director',
      });
      const { project, token } = await setupProjectWithDirector();
      // 別ユーザーを、参加者行に値を持たせた状態で参加させる
      await createMember({
        projectId: project.id,
        userId: owner.id,
        name: '上書きされる人',
        organizationName: 'プロジェクト側の所属',
        jobTitle: 'designer',
      });

      const res = await api<MembersBody>(`/api/v1/projects/${project.id}/members`, { token });
      const m = res.body.data.find((x) => x.name === '上書きされる人');

      expect(m?.organizationName).toBe('プロジェクト側の所属');
      expect(m?.jobTitle).toBe('designer');
    });
  });
});
