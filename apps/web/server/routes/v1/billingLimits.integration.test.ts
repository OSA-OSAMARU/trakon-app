import { prisma } from '@trakon/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { __setMailerForTest } from '../../lib/mailer.js';
import { signTestJwt } from '../../test/auth.js';
import {
  addProjectMemberWithRole,
  createOrgMember,
  createProject,
  createUser,
  primaryOrganizationId,
  setBillingSubscription,
} from '../../test/factories.js';
import { api } from '../../test/request.js';

// =============================================================================
// 上限判定と凍結 (設計書 §7.11)
//
// 【確定要件】上限超過分は削除せず「新規編集不可・閲覧のみ」で凍結する。
// 課金・上限・凍結のエラーは 404 に混ぜず 409 / 403 + 専用コードで返す (§3.2.4b)。
// =============================================================================

let ownerToken: string;
let ownerUserId: string;
let organizationId: string;

beforeEach(async () => {
  __setMailerForTest({});
  const owner = await createUser();
  ownerUserId = owner.id;
  organizationId = await primaryOrganizationId(owner.id);
  ownerToken = await signTestJwt({ authUserId: owner.authUserId, email: owner.email });
});

describe('プロジェクト数上限', () => {
  describe('異常系', () => {
    it('Free で 3 件目を作ろうとすると 409 PROJECT_LIMIT_REACHED', async () => {
      await createProject({ createdBy: ownerUserId });
      await createProject({ createdBy: ownerUserId });

      const res = await api<{ error: { code: string; details?: { projectLimit: number } } }>(
        '/api/v1/projects',
        {
          method: 'POST',
          token: ownerToken,
          body: {
            name: '3 件目',
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            items: [{ name: '制作物' }],
          },
        },
      );

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROJECT_LIMIT_REACHED');
      expect(res.body.error.details?.projectLimit).toBe(2);
    });
  });

  describe('正常系', () => {
    it('アーカイブすると枠が空いて作成できる (削除は不要)', async () => {
      await createProject({ createdBy: ownerUserId });
      await createProject({ createdBy: ownerUserId, archivedAt: new Date() });

      const res = await api('/api/v1/projects', {
        method: 'POST',
        token: ownerToken,
        body: {
          name: '枠が空いた',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          items: [{ name: '制作物' }],
        },
      });

      expect(res.status).toBe(201);
    });

    it('Team は無制限に作れる', async () => {
      await setBillingSubscription({ organizationId, planCode: 'team', status: 'active' });
      for (let i = 0; i < 3; i += 1) {
        await createProject({ createdBy: ownerUserId, name: `P${i}` });
      }

      const res = await api('/api/v1/projects', {
        method: 'POST',
        token: ownerToken,
        body: {
          name: '4 件目',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          items: [{ name: '制作物' }],
        },
      });

      expect(res.status).toBe(201);
    });
  });
});

describe('プロジェクトの凍結', () => {
  it('上限超過分は閲覧できるが編集できない (削除もされない)', async () => {
    const first = await createProject({ createdBy: ownerUserId, name: '維持1' });
    await createProject({ createdBy: ownerUserId, name: '維持2' });
    // 上限を超えた 3 件目を直接作る (作成 API は 409 になるため)
    const third = await createProject({ createdBy: ownerUserId, name: '超過' });

    // 閲覧はできる
    const read = await api(`/api/v1/projects/${third.id}`, { token: ownerToken });
    expect(read.status).toBe(200);

    // 編集は 403 PROJECT_FROZEN
    const write = await api<{ error: { code: string } }>(`/api/v1/projects/${third.id}`, {
      method: 'PATCH',
      token: ownerToken,
      body: { name: '変更' },
    });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('PROJECT_FROZEN');

    // 上限内のプロジェクトは編集できる
    const ok = await api(`/api/v1/projects/${first.id}`, {
      method: 'PATCH',
      token: ownerToken,
      body: { name: '変更OK' },
    });
    expect(ok.status).toBe(200);

    // データは削除されていない
    expect(await prisma.project.count({ where: { organizationId, deletedAt: null } })).toBe(3);
  });

  it('維持するプロジェクトを選び直すと凍結対象が入れ替わる', async () => {
    const first = await createProject({ createdBy: ownerUserId, name: '古い1' });
    await createProject({ createdBy: ownerUserId, name: '古い2' });
    const third = await createProject({ createdBy: ownerUserId, name: '新しい' });

    const res = await api<{ data: { frozenIds: string[] } }>(
      '/api/v1/organizations/me/retained-projects',
      { method: 'POST', token: ownerToken, body: { projectIds: [third.id, first.id] } },
    );

    expect(res.status).toBe(200);
    expect(res.body.data.frozenIds).toHaveLength(1);
    expect(res.body.data.frozenIds).not.toContain(third.id);

    // 選び直した先は編集できる
    const write = await api(`/api/v1/projects/${third.id}`, {
      method: 'PATCH',
      token: ownerToken,
      body: { name: '編集できる' },
    });
    expect(write.status).toBe(200);
  });

  it('上限を超える件数を維持指定すると 409', async () => {
    const a = await createProject({ createdBy: ownerUserId });
    const b = await createProject({ createdBy: ownerUserId });
    const c = await createProject({ createdBy: ownerUserId });

    const res = await api<{ error: { code: string } }>(
      '/api/v1/organizations/me/retained-projects',
      { method: 'POST', token: ownerToken, body: { projectIds: [a.id, b.id, c.id] } },
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_LIMIT_REACHED');
  });
});

describe('契約状態による書き込み停止', () => {
  it('未払いなら閲覧はできるが編集は 403 SUBSCRIPTION_READ_ONLY', async () => {
    const project = await createProject({ createdBy: ownerUserId });
    await setBillingSubscription({ organizationId, planCode: 'team', status: 'unpaid' });

    const read = await api(`/api/v1/projects/${project.id}`, { token: ownerToken });
    expect(read.status).toBe(200);

    const write = await api<{ error: { code: string } }>(`/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      token: ownerToken,
      body: { name: '変更' },
    });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
  });

  it('支払い猶予期間中は通常どおり編集できる', async () => {
    const project = await createProject({ createdBy: ownerUserId });
    await setBillingSubscription({
      organizationId,
      planCode: 'team',
      status: 'past_due',
      gracePeriodEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });

    const res = await api(`/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      token: ownerToken,
      body: { name: '猶予中でも編集できる' },
    });

    expect(res.status).toBe(200);
  });

  it('非参加者には課金エラーではなく 404 が先に返る (秘匿を維持する)', async () => {
    const project = await createProject({ createdBy: ownerUserId });
    await setBillingSubscription({ organizationId, planCode: 'team', status: 'unpaid' });
    const outsider = await createUser();
    const token = await signTestJwt({
      authUserId: outsider.authUserId,
      email: outsider.email,
    });

    const res = await api(`/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      token,
      body: { name: '変更' },
    });

    expect(res.status).toBe(404);
  });
});

describe('座席上限', () => {
  it('Free で 2 人目を招待しようとすると 409 SEAT_LIMIT_REACHED', async () => {
    const project = await createProject({ createdBy: ownerUserId });

    const res = await api<{ error: { code: string; details?: { seatLimit: number } } }>(
      `/api/v1/projects/${project.id}/invitations`,
      { method: 'POST', token: ownerToken, body: { email: 'a@example.test', roleType: 'editor' } },
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEAT_LIMIT_REACHED');
    expect(res.body.error.details?.seatLimit).toBe(1);
  });

  it('Team は 5 名まで招待でき、未受諾の招待も座席を消費する', async () => {
    await setBillingSubscription({ organizationId, planCode: 'team', status: 'active' });
    const project = await createProject({ createdBy: ownerUserId });

    // オーナー 1 + 招待 4 = 5 席
    for (let i = 0; i < 4; i += 1) {
      const res = await api(`/api/v1/projects/${project.id}/invitations`, {
        method: 'POST',
        token: ownerToken,
        body: { email: `member${i}@example.test`, roleType: 'editor' },
      });
      expect(res.status).toBe(201);
    }

    // 5 件目は上限超過
    const over = await api<{ error: { code: string } }>(
      `/api/v1/projects/${project.id}/invitations`,
      { method: 'POST', token: ownerToken, body: { email: 'over@example.test', roleType: 'editor' } },
    );
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('SEAT_LIMIT_REACHED');
  });

  it('招待を取り消すと座席が解放される', async () => {
    await setBillingSubscription({ organizationId, planCode: 'personal', status: 'active' });
    const project = await createProject({ createdBy: ownerUserId });
    // Personal は 1 席。オーナーで埋まっているので招待できない
    const blocked = await api(`/api/v1/projects/${project.id}/invitations`, {
      method: 'POST',
      token: ownerToken,
      body: { email: 'x@example.test', roleType: 'editor' },
    });
    expect(blocked.status).toBe(409);

    // Team に上げて 1 件招待 → 取り消すと戻る
    await setBillingSubscription({ organizationId, planCode: 'team', status: 'active' });
    const created = await api<{ data: { id: string } }>(
      `/api/v1/projects/${project.id}/invitations`,
      { method: 'POST', token: ownerToken, body: { email: 'y@example.test', roleType: 'editor' } },
    );
    const before = await api<{ data: { entitlement: { usage: { seatCount: number } } } }>(
      '/api/v1/billing/subscription',
      { token: ownerToken },
    );
    expect(before.body.data.entitlement.usage.seatCount).toBe(2);

    await api(`/api/v1/projects/${project.id}/invitations/${created.body.data.id}`, {
      method: 'DELETE',
      token: ownerToken,
    });

    const after = await api<{ data: { entitlement: { usage: { seatCount: number } } } }>(
      '/api/v1/billing/subscription',
      { token: ownerToken },
    );
    expect(after.body.data.entitlement.usage.seatCount).toBe(1);
  });
});

describe('組織メンバー管理', () => {
  it('会員を除外すると座席が解放されるが、プロジェクト参加者行は残る', async () => {
    await setBillingSubscription({ organizationId, planCode: 'team', status: 'active' });
    const project = await createProject({ createdBy: ownerUserId });
    const member = await addProjectMemberWithRole({ projectId: project.id, roleType: 'editor' });
    await createOrgMember({ organizationId, userId: member.user.id });

    const res = await api(`/api/v1/organizations/me/members/${member.user.id}`, {
      method: 'DELETE',
      token: ownerToken,
    });

    expect(res.status).toBe(204);
    // 座席は解放される
    expect(
      await prisma.organizationMember.count({ where: { organizationId, deletedAt: null } }),
    ).toBe(1);
    // プロジェクト参加者行は消さない (データを削除しない方針)
    expect(
      await prisma.projectMember.count({ where: { id: member.member.id, deletedAt: null } }),
    ).toBe(1);
  });

  it('オーナーは除外できない', async () => {
    const res = await api<{ error: { code: string } }>(
      `/api/v1/organizations/me/members/${ownerUserId}`,
      { method: 'DELETE', token: ownerToken },
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANNOT_REMOVE_OWNER');
  });
});
