import { prisma } from '@trakon/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { __setMailerForTest, type BallTossedEmail, type Mailer } from '../../lib/mailer.js';
import {
  createItem,
  createMember,
  createUser,
  setupProjectWithDirector,
} from '../../test/factories.js';
import { api } from '../../test/request.js';

// =============================================================================
// TOSS 時のメール通知 (#79)
//
// 【方針】TOSS では新しいボール保持者へ通知する。**TOSS の取り消しでは送らない。**
// 誤操作の取り消しは日常的に起こる操作で、そのたびに「取り消されました」が届くと
// 受け手に不要な負担がかかる。取り消しは ball_events に残るので追跡性は失われない。
// =============================================================================

let sent: BallTossedEmail[] = [];
let ctx: Awaited<ReturnType<typeof setupProjectWithDirector>>;
let itemId: string;
let base: string;

beforeEach(async () => {
  sent = [];
  const mailer: Partial<Mailer> = {
    async sendBallTossed(input) {
      sent.push(input);
    },
  };
  __setMailerForTest(mailer);

  ctx = await setupProjectWithDirector();
  const item = await createItem({ projectId: ctx.project.id, name: 'トップページ' });
  itemId = item.id;
  base = `/api/v1/projects/${ctx.project.id}/items/${itemId}/plans`;
});

type PlanDTO = { id: string };

function createPlan(body: Record<string, unknown>) {
  return api<{ data: PlanDTO }>(base, { method: 'POST', token: ctx.token, body });
}
function act(planId: string, action: string) {
  return api<{ data: unknown; warnings?: string[] }>(`${base}/${planId}/${action}`, {
    method: 'POST',
    token: ctx.token,
    body: {},
  });
}

/** 承認済みの先行予定と、その後続予定を用意する。 */
async function setupApprovedChain(successorExecutorId: string) {
  const successor = await createPlan({
    title: '実装',
    category: 'coding',
    scheduledDate: '2026-07-20',
    dueDate: '2026-07-25',
    executorMemberId: successorExecutorId,
    progressManagerMemberId: ctx.member.id,
  });
  const lead = await createPlan({
    title: 'デザイン確認',
    category: 'review',
    scheduledDate: '2026-07-10',
    executorMemberId: ctx.member.id,
    progressManagerMemberId: ctx.member.id,
    successorPlanId: successor.body.data.id,
  });
  await act(lead.body.data.id, 'approve');
  return { leadId: lead.body.data.id, successorId: successor.body.data.id };
}

describe('TOSS 通知メール (#79)', () => {
  it('後続予定の実施者へ通知する', async () => {
    const executor = await createMember({
      projectId: ctx.project.id,
      name: '横山 美咲',
      email: 'yokoyama@example.test',
      memberType: 'production',
    });
    const { leadId } = await setupApprovedChain(executor.id);

    const res = await act(leadId, 'toss');
    expect(res.status).toBe(200);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'yokoyama@example.test',
      projectName: ctx.project.name,
      itemName: 'トップページ',
      planTitle: '実装',
      dueDate: '2026-07-25',
    });
    // 予定を開けるリンクを載せる
    expect(sent[0]!.planUrl).toContain(`/projects/${ctx.project.id}/items/${itemId}`);
  });

  it('アカウント紐付け済みなら通知先メールへ送る (ログイン用ではなく)', async () => {
    const user = await createUser({
      email: 'login@example.test',
      notificationEmail: 'notify@example.test',
      withOrganization: false,
    });
    const executor = await createMember({
      projectId: ctx.project.id,
      userId: user.id,
      email: 'member-row@example.test',
      memberType: 'production',
    });
    const { leadId } = await setupApprovedChain(executor.id);

    await act(leadId, 'toss');

    expect(sent[0]!.to).toBe('notify@example.test');
  });

  it('TOSS を取り消しても通知しない (誤操作の心理的負担を避ける)', async () => {
    const executor = await createMember({
      projectId: ctx.project.id,
      email: 'undo@example.test',
      memberType: 'production',
    });
    const { leadId } = await setupApprovedChain(executor.id);

    await act(leadId, 'toss');
    expect(sent).toHaveLength(1);

    await act(leadId, 'toss-undo');
    expect(sent).toHaveLength(1); // 増えない
  });

  it('確認依頼・承認・差し戻しでは送らない (今回の範囲は TOSS のみ)', async () => {
    const approver = await createMember({ projectId: ctx.project.id, memberType: 'client' });
    const plan = await createPlan({
      title: 'デザイン作成',
      category: 'design',
      scheduledDate: '2026-07-01',
      executorMemberId: ctx.member.id,
      approverMemberId: approver.id,
      progressManagerMemberId: ctx.member.id,
    });
    const planId = plan.body.data.id;

    await act(planId, 'request-review');
    await act(planId, 'approve');
    await act(planId, 'send-back');

    expect(sent).toHaveLength(0);
  });

  it('メールが登録されていない実施者へは送らない', async () => {
    const executor = await prisma.projectMember.create({
      data: {
        projectId: ctx.project.id,
        userId: null,
        name: 'メール未登録',
        email: null,
        organizationName: '',
        memberType: 'production',
        roleType: 'editor',
        sortOrder: 9,
      },
    });
    const { leadId } = await setupApprovedChain(executor.id);

    const res = await act(leadId, 'toss');

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it('送信に失敗しても TOSS は成功し、warnings で伝える', async () => {
    __setMailerForTest({
      async sendBallTossed() {
        throw new Error('smtp down');
      },
    });
    const executor = await createMember({
      projectId: ctx.project.id,
      email: 'fail@example.test',
      memberType: 'production',
    });
    const { leadId } = await setupApprovedChain(executor.id);

    const res = await act(leadId, 'toss');

    expect(res.status).toBe(200);
    expect(res.body.warnings?.[0]).toContain('通知メールの送信に失敗しました');
    // TOSS 自体は巻き戻さない
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: leadId } });
    expect(plan.status).toBe('completed');
  });
});
