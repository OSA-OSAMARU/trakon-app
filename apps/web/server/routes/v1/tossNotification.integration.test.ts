import { prisma } from '@trakon/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { __setMailerForTest, type BallHandoffEmail, type Mailer } from '../../lib/mailer.js';
import {
  createItem,
  createMember,
  createUser,
  setupProjectWithDirector,
} from '../../test/factories.js';
import { api } from '../../test/request.js';

// =============================================================================
// ボールの受け渡し時のメール通知 (#79 / #206)
//
// 【方針】TOSS では新しいボール保持者へ通知する。**TOSS の取り消しでは送らない。**
// 誤操作の取り消しは日常的に起こる操作で、そのたびに「取り消されました」が届くと
// 受け手に不要な負担がかかる。取り消しは ball_events に残るので追跡性は失われない。
// =============================================================================

let sent: BallHandoffEmail[] = [];
let ctx: Awaited<ReturnType<typeof setupProjectWithDirector>>;
let itemId: string;
let base: string;

beforeEach(async () => {
  sent = [];
  const mailer: Partial<Mailer> = {
    async sendBallHandoff(input) {
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
function act(planId: string, action: string, body: Record<string, unknown> = {}) {
  return api<{ data: unknown; warnings?: string[] }>(`${base}/${planId}/${action}`, {
    method: 'POST',
    token: ctx.token,
    body,
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
      kind: 'tossed',
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

  it('承認では送らない (ボールの受け渡しではないため)', async () => {
    // #206 で確認依頼 (確認TOSS) は通知するようになったが、承認はボールが
    // 進行責任者へ移るだけで「相手に何かを頼む」操作ではないため送らない。
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
    sent.length = 0;

    await act(planId, 'approve');

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
      async sendBallHandoff() {
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

// =============================================================================
// 確認TOSS / コメントRETURN の通知 (#206)
// =============================================================================

describe('受け渡しに添えたメッセージ (#206)', () => {
  /** 承認者付きの予定を作り、確認待ちの一歩手前まで整える。 */
  async function setupWithApprover() {
    const executorUser = await createUser({
      email: 'executor@example.test',
      withOrganization: false,
    });
    const executor = await createMember({
      projectId: ctx.project.id,
      userId: executorUser.id,
      name: '杉野 遥',
      email: 'executor@example.test',
      memberType: 'production',
    });
    const approver = await createMember({
      projectId: ctx.project.id,
      name: '石原 美咲',
      email: 'approver@example.test',
      memberType: 'client',
    });
    const plan = await createPlan({
      title: 'Webデザイン',
      category: 'design',
      scheduledDate: '2026-07-21',
      dueDate: '2026-07-24',
      executorMemberId: executor.id,
      approverMemberId: approver.id,
      progressManagerMemberId: ctx.member.id,
    });
    return { planId: plan.body.data.id, executor, approver };
  }

  it('確認TOSS は承認者へ、添えたメッセージ付きで通知する', async () => {
    const { planId } = await setupWithApprover();

    const res = await act(planId, 'request-review', {
      note: 'ファーストビューのコピーと写真のバランスをご確認ください。',
    });

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: 'review_requested',
      to: 'approver@example.test',
      planTitle: 'Webデザイン',
      note: 'ファーストビューのコピーと写真のバランスをご確認ください。',
    });
  });

  it('確認TOSS のメッセージは任意', async () => {
    const { planId } = await setupWithApprover();

    const res = await act(planId, 'request-review');

    expect(res.status).toBe(200);
    expect(sent[0]).toMatchObject({ kind: 'review_requested', note: null });
  });

  it('コメントRETURN は実施者へ、戻す理由付きで通知する', async () => {
    const { planId } = await setupWithApprover();
    await act(planId, 'request-review');
    sent.length = 0;

    const res = await act(planId, 'request-review-undo', {
      note: '商品写真をもう少し大きくしてください。',
    });

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: 'returned',
      to: 'executor@example.test',
      note: '商品写真をもう少し大きくしてください。',
    });
  });

  it('コメントRETURN は理由が無ければ 422 で弾く', async () => {
    // 理由が無いと実施者は何を直せばよいか分からない
    const { planId } = await setupWithApprover();
    await act(planId, 'request-review');
    sent.length = 0;

    const res = await act(planId, 'request-review-undo');

    expect(res.status).toBe(422);
    expect(sent).toHaveLength(0);
  });

  it('添えたメッセージは進行履歴にも残る', async () => {
    const { planId } = await setupWithApprover();
    await act(planId, 'request-review', { note: 'ここを見てください' });

    const events = await prisma.ballEvent.findMany({
      where: { planId, eventType: 'review_requested' },
      select: { note: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.note).toBe('ここを見てください');
  });
});
