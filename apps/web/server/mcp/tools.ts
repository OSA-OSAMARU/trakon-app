import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  PLAN_CATEGORIES,
  PLAN_CATEGORY_LABEL,
  SCHEDULE_THEMES,
  type ProjectRole,
} from '@trakon/shared';

import type { McpScope } from '../lib/mcpOAuth.js';
import type { ProjectItemDTO } from '../services/items.js';
import type { MemberDTO } from '../services/members.js';
import type { PlanDTO, PlanWithEventsDTO, MemberRef } from '../services/plans.js';
import type { ProjectDetailDTO, ProjectSummaryDTO } from '../services/projects.js';
import type { DashboardDTO } from '../services/dashboard.js';
import type { ApiFailure, Dispatch } from './dispatch.js';

/**
 * TRAKON の MCP ツール群 (設計書 08-mcp §8.7)。
 *
 * どのツールも既存 REST API を `dispatch` で呼ぶだけの薄いアダプタ。権限・検証・監査は
 * REST 側が持つので、ここでは**入力の受け渡しと、AI が読みやすい形への整形**だけを行う。
 */

export const MCP_SERVER_NAME = 'trakon';
export const MCP_SERVER_VERSION = '1.0.0';

const SERVER_INSTRUCTIONS = `TRAKON は制作進行管理ツールです。プロジェクト > 制作物 (item) > 予定 (plan) の階層で、予定ごとに「ボール (今だれが対応すべきか)」を管理します。

使い方の原則:
- ID は推測しないでください。まず list_projects でプロジェクトを、get_project で制作物と参加者の ID を確認してから操作します。
- 人や制作物を名前で指定されたら、get_project の一覧から一致するものを選んでください。候補が複数あるときや見つからないときは利用者に確認してください。
- 日付は YYYY-MM-DD (日本時間) です。「来週の月曜」などの相対的な指定は、応答に含まれる today を基準に計算してください。
- 予定には 3 つの役割があります: 実施者 (executor, 作業する人) / 承認者 (approver, 確認する人, 任意) / 進行責任者 (progress_manager, 承認後に次の工程へ TOSS する人)。
- ボールの流れ: 実施中 → (確認依頼) → 確認待ち → (承認) → 承認済み → (TOSS) → 後続予定の実施者へ。差し戻しで実施者に戻ります。
- 書き込み (作成・変更・削除・ボール操作) の前に、何をするかを利用者に確認してください。
- エラーが返ったら、メッセージの内容 (権限がない・プロジェクト期間外など) を利用者に分かる言葉で伝えてください。`;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
function todayInJst(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// 入力スキーマの部品
// -----------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定してください。')
  .describe('日付 (YYYY-MM-DD, 日本時間)');
const projectId = z.string().uuid().describe('プロジェクト ID (list_projects で取得)');
const planId = z.string().uuid().describe('予定 ID (list_plans で取得)');
const memberId = z.string().uuid().describe('参加者 ID (get_project の members[].id)');
const categoryDescription = `作業カテゴリ: ${PLAN_CATEGORIES.map((c) => `${c}=${PLAN_CATEGORY_LABEL[c]}`).join(', ')}`;

export const BALL_ACTIONS = {
  request_review: { path: 'request-review', label: '確認依頼 (実施者 → 承認者)' },
  request_review_undo: {
    path: 'request-review-undo',
    label: '確認依頼の取り消し / 承認者から実施者へ戻す (note 必須)',
  },
  approve: { path: 'approve', label: '承認 (承認者 → 進行責任者)' },
  approve_undo: { path: 'approve-undo', label: '承認の取り消し' },
  send_back: { path: 'send-back', label: '差し戻し (承認者 → 実施者)' },
  send_back_to_predecessor: {
    path: 'send-back-to-predecessor',
    label: '前工程へ差し戻し (先行予定を再開)',
  },
  toss: { path: 'toss', label: '次の工程へ TOSS (進行責任者 → 後続予定の実施者。管理者のみ)' },
  toss_undo: { path: 'toss-undo', label: 'TOSS の取り消し' },
} as const;
type BallActionKey = keyof typeof BALL_ACTIONS;
const BALL_ACTION_KEYS = Object.keys(BALL_ACTIONS) as [BallActionKey, ...BallActionKey[]];

// -----------------------------------------------------------------------------
// 出力の整形
// -----------------------------------------------------------------------------

type Ref = { id: string; name: string } | null;
const ref = (m: MemberRef | { id: string; name: string } | null | undefined): Ref =>
  m ? { id: m.id, name: m.name } : null;

/** AI のコンテキストを節約するための予定の要約形 (§8.7) */
export function summarizePlan(p: PlanDTO) {
  return {
    id: p.id,
    itemId: p.itemId,
    title: p.title,
    category: p.category,
    scheduledDate: p.scheduledDate,
    dueDate: p.dueDate,
    executor: ref(p.executor),
    approver: ref(p.approver),
    progressManager: ref(p.progressManager),
    ballHolder: ref(p.ballHolder),
    ballState: p.ballState,
    status: p.status,
    successorPlanId: p.successorPlanId,
    memo: p.memo,
  };
}

function ok(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorText(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** REST の失敗をツールのエラー結果にする。AI が理由を読んで言い直せるよう、コードと文言を残す */
export function toToolError(res: ApiFailure): CallToolResult {
  let text = `${res.code}: ${res.message}`;
  const fieldErrors = (res.details as { fieldErrors?: Record<string, string[]> } | undefined)
    ?.fieldErrors;
  if (fieldErrors && Object.keys(fieldErrors).length > 0) {
    text += `\n${Object.entries(fieldErrors)
      .map(([k, v]) => `- ${k}: ${v.join(', ')}`)
      .join('\n')}`;
  }
  if (res.status === 404) {
    text += '\n(ID が正しいか、利用者がそのプロジェクトに参加しているかを確認してください)';
  }
  return errorText(text);
}

function withoutUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// -----------------------------------------------------------------------------
// サーバ組み立て
// -----------------------------------------------------------------------------

export type CreateMcpServerInput = {
  dispatch: Dispatch;
  scopes: readonly McpScope[];
  /**
   * planId → itemId の解決 (REST のパスに itemId が要るため)。**projectId 配下に限定して引く。**
   * 参加していないプロジェクトでも、続く REST 呼び出しが 404 に集約するので存在は漏れない。
   */
  resolvePlanItemId: (projectId: string, planId: string) => Promise<string | null>;
  now?: () => Date;
};

export function createTrakonMcpServer(input: CreateMcpServerInput): McpServer {
  const { dispatch } = input;
  const today = () => todayInJst(input.now?.() ?? new Date());

  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'TRAKON' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const planPath = async (pid: string, plid: string): Promise<string | CallToolResult> => {
    const itemId = await input.resolvePlanItemId(pid, plid);
    if (!itemId) {
      return toToolError({ ok: false, status: 404, code: 'NOT_FOUND', message: 'Plan not found.' });
    }
    return `/projects/${pid}/items/${itemId}/plans/${plid}`;
  };

  // ===========================================================================
  // 読み取り (scope: read)
  // ===========================================================================
  if (input.scopes.includes('read')) {
    server.registerTool(
      'list_projects',
      {
        title: 'プロジェクト一覧',
        description:
          '利用者が参加しているプロジェクトの一覧を返します。今日の日付 (today, 日本時間) も含みます。最初に呼んでプロジェクト ID を確認してください。',
        inputSchema: {
          archived: z
            .boolean()
            .optional()
            .describe('true ならアーカイブ済みのプロジェクトだけを返す (既定: false)'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ archived }) => {
        const res = await dispatch<ProjectSummaryDTO[]>(
          'GET',
          `/projects?limit=200${archived ? '&archived=true' : ''}`,
        );
        if (!res.ok) return toToolError(res);
        return ok({
          today: today(),
          projects: res.data.map((p) => ({
            id: p.id,
            name: p.name,
            clientName: p.clientName,
            startDate: p.startDate,
            endDate: p.endDate,
            myRole: p.role,
            progressManager: p.progressManager,
            overdueCount: p.overdueCount,
          })),
        });
      },
    );

    server.registerTool(
      'get_project',
      {
        title: 'プロジェクト詳細',
        description:
          'プロジェクトの概要・制作物 (items) ・参加者 (members) を返します。予定の作成や担当者の指定に必要な itemId / memberId はここで確認してください。',
        inputSchema: { projectId },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ projectId: pid }) => {
        const [project, items, members] = await Promise.all([
          dispatch<ProjectDetailDTO>('GET', `/projects/${pid}`),
          dispatch<ProjectItemDTO[]>('GET', `/projects/${pid}/items`),
          dispatch<MemberDTO[]>('GET', `/projects/${pid}/members`),
        ]);
        if (!project.ok) return toToolError(project);
        if (!items.ok) return toToolError(items);
        if (!members.ok) return toToolError(members);
        const p = project.data;
        return ok({
          today: today(),
          project: {
            id: p.id,
            name: p.name,
            clientName: p.clientName,
            startDate: p.startDate,
            endDate: p.endDate,
            status: p.status,
            myRole: p.role,
            defaultProgressManager: p.progressManager,
          },
          items: items.data.map((it) => ({ id: it.id, name: it.name })),
          // メール・アバター URL は AI へ渡さない (最小限の個人情報, SR-PRIVACY-01)
          members: members.data.map((m) => ({
            id: m.id,
            name: m.name,
            organizationName: m.organizationName,
            memberType: m.memberType,
            jobTitle: m.jobTitle,
            role: m.roleType as ProjectRole,
          })),
        });
      },
    );

    server.registerTool(
      'list_plans',
      {
        title: '予定一覧',
        description:
          'プロジェクトの予定を開始日順に返します。期間 (from / to は開始日で絞り込み)・制作物・参加者で絞り込めます。memberId は実施者・承認者・進行責任者・ボール保持者のいずれかに一致する予定を返します。',
        inputSchema: {
          projectId,
          from: isoDate.optional().describe('この日以降に開始する予定 (YYYY-MM-DD)'),
          to: isoDate.optional().describe('この日以前に開始する予定 (YYYY-MM-DD)'),
          itemId: z.string().uuid().optional().describe('制作物 ID で絞り込む'),
          memberId: memberId.optional(),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ projectId: pid, from, to, itemId, memberId: mid }) => {
        const qs = new URLSearchParams(withoutUndefined({ from, to }) as Record<string, string>);
        const res = await dispatch<PlanDTO[]>(
          'GET',
          `/projects/${pid}/plans${qs.size > 0 ? `?${qs}` : ''}`,
        );
        if (!res.ok) return toToolError(res);
        const plans = res.data
          .filter((p) => !itemId || p.itemId === itemId)
          .filter(
            (p) =>
              !mid ||
              [p.executor, p.approver, p.progressManager, p.ballHolder].some((m) => m?.id === mid),
          )
          .map(summarizePlan);
        return ok({ today: today(), count: plans.length, plans });
      },
    );

    server.registerTool(
      'get_plan',
      {
        title: '予定の詳細',
        description:
          '予定 1 件の詳細と、ボールの受け渡し履歴 (誰がいつ確認依頼・承認・TOSS したか) を返します。',
        inputSchema: { projectId, planId },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ projectId: pid, planId: plid }) => {
        const path = await planPath(pid, plid);
        if (typeof path !== 'string') return path;
        const res = await dispatch<PlanWithEventsDTO>('GET', path);
        if (!res.ok) return toToolError(res);
        return ok({
          plan: summarizePlan(res.data.plan),
          events: res.data.events.map((e) => ({
            eventType: e.eventType,
            actor: ref(e.actor),
            occurredAt: e.occurredAt,
            note: e.note,
          })),
        });
      },
    );

    server.registerTool(
      'get_my_dashboard',
      {
        title: '今日の自分のボール',
        description:
          '利用者本人が今日対応すべき予定 (自分がボールを持っている予定) を、プロジェクトごとに返します。期限切れ (isOverdue) も含みます。',
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const res = await dispatch<DashboardDTO>('GET', '/users/me/dashboard');
        if (!res.ok) return toToolError(res);
        const d = res.data;
        return ok({
          today: d.today,
          summary: d.summary,
          projects: d.projects
            .map((p) => ({
              id: p.id,
              name: p.name,
              myTasks: p.memberSections.filter((s) => s.member.isMe).flatMap((s) => s.tasks),
            }))
            .filter((p) => p.myTasks.length > 0),
        });
      },
    );
  }

  // ===========================================================================
  // 書き込み (scope: write)
  // ===========================================================================
  if (input.scopes.includes('write')) {
    server.registerTool(
      'create_item',
      {
        title: '制作物を作成',
        description:
          'プロジェクトに制作物 (スケジュールの列) を追加します。編集者以上の権限が必要です。',
        inputSchema: {
          projectId,
          name: z.string().trim().min(1).max(255).describe('制作物の名前 (例: バナー, LP)'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ projectId: pid, name }) => {
        const res = await dispatch<ProjectItemDTO>('POST', `/projects/${pid}/items`, { name });
        if (!res.ok) return toToolError(res);
        return ok({ item: { id: res.data.id, name: res.data.name } });
      },
    );

    server.registerTool(
      'create_plan',
      {
        title: '予定を作成',
        description:
          '制作物に予定を追加します。日付はプロジェクト期間内である必要があります。担当者 (executorMemberId など) は get_project の members[].id を指定します。進行責任者を省略するとプロジェクトの既定値が入ります。',
        inputSchema: {
          projectId,
          itemId: z.string().uuid().describe('制作物 ID (get_project の items[].id)'),
          title: z.string().trim().min(1).max(255).describe('予定のタイトル'),
          category: z.enum(PLAN_CATEGORIES).describe(categoryDescription),
          scheduledDate: isoDate.describe('開始日 (YYYY-MM-DD)'),
          dueDate: isoDate
            .optional()
            .describe('終了日 (YYYY-MM-DD)。開始日以降。省略すると開始日のみの予定'),
          executorMemberId: memberId.optional().describe('実施者 (作業する人) の参加者 ID'),
          approverMemberId: memberId.optional().describe('承認者 (確認する人) の参加者 ID'),
          progressManagerMemberId: memberId
            .optional()
            .describe('進行責任者の参加者 ID (省略時はプロジェクト既定)'),
          memo: z.string().max(2000).optional().describe('メモ'),
          colorTheme: z
            .enum(SCHEDULE_THEMES)
            .optional()
            .describe('カードの色 (省略時はカテゴリ既定)'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ projectId: pid, itemId, ...body }) => {
        const res = await dispatch<PlanDTO>(
          'POST',
          `/projects/${pid}/items/${itemId}/plans`,
          withoutUndefined(body),
        );
        if (!res.ok) return toToolError(res);
        return ok({ plan: summarizePlan(res.data) });
      },
    );

    server.registerTool(
      'update_plan',
      {
        title: '予定を変更',
        description:
          '予定の内容を変更します。変えたい項目だけ指定してください。担当者・終了日・メモは null を指定すると未設定に戻せます。itemId を指定すると同じプロジェクト内の別の制作物へ移動します。',
        inputSchema: {
          projectId,
          planId,
          title: z.string().trim().min(1).max(255).optional(),
          category: z.enum(PLAN_CATEGORIES).optional().describe(categoryDescription),
          scheduledDate: isoDate.optional().describe('開始日 (YYYY-MM-DD)'),
          dueDate: isoDate.nullable().optional().describe('終了日 (YYYY-MM-DD)。null で未設定'),
          executorMemberId: memberId.nullable().optional().describe('実施者。null で未設定'),
          approverMemberId: memberId.nullable().optional().describe('承認者。null で未設定'),
          progressManagerMemberId: memberId
            .nullable()
            .optional()
            .describe('進行責任者。null で未設定'),
          itemId: z.string().uuid().optional().describe('移動先の制作物 ID'),
          memo: z.string().max(2000).nullable().optional(),
          colorTheme: z.enum(SCHEDULE_THEMES).nullable().optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ projectId: pid, planId: plid, ...body }) => {
        const changes = withoutUndefined(body);
        if (Object.keys(changes).length === 0) {
          return errorText('変更する項目が指定されていません。');
        }
        const path = await planPath(pid, plid);
        if (typeof path !== 'string') return path;
        const res = await dispatch<PlanDTO>('PATCH', path, changes);
        if (!res.ok) return toToolError(res);
        return ok({ plan: summarizePlan(res.data) });
      },
    );

    server.registerTool(
      'delete_plan',
      {
        title: '予定を削除',
        description:
          '予定を削除します。ボールの受け渡し履歴がある予定は削除できません。実行前に必ず利用者に確認してください。',
        inputSchema: { projectId, planId },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async ({ projectId: pid, planId: plid }) => {
        const path = await planPath(pid, plid);
        if (typeof path !== 'string') return path;
        const res = await dispatch('DELETE', path);
        if (!res.ok) return toToolError(res);
        return ok({ deleted: true, planId: plid });
      },
    );

    server.registerTool(
      'ball_action',
      {
        title: 'ボールを渡す・戻す',
        description: `予定のボールを受け渡します。操作できるのはその役割を持つ人だけです (画面と同じ規則)。相手には通知メールが送られます。action:\n${BALL_ACTION_KEYS.map((k) => `- ${k}: ${BALL_ACTIONS[k].label}`).join('\n')}`,
        inputSchema: {
          projectId,
          planId,
          action: z.enum(BALL_ACTION_KEYS).describe('操作の種類'),
          note: z
            .string()
            .max(2000)
            .optional()
            .describe('相手へのメッセージ (履歴と通知メールに残る)。request_review_undo では必須'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ projectId: pid, planId: plid, action, note }) => {
        const path = await planPath(pid, plid);
        if (typeof path !== 'string') return path;
        // どの操作も { plan, ... } を返す。前工程への差し戻しは再開した先行予定 (predecessor) も返す
        const res = await dispatch<{ plan: PlanDTO; predecessor?: PlanDTO }>(
          'POST',
          `${path}/${BALL_ACTIONS[action].path}`,
          note !== undefined ? { note } : {},
        );
        if (!res.ok) return toToolError(res);
        return ok({
          action,
          plan: summarizePlan(res.data.plan),
          ...(res.data.predecessor ? { predecessor: summarizePlan(res.data.predecessor) } : {}),
          // 通知メールの送信失敗など。操作自体は成功している
          ...(res.warnings ? { warnings: res.warnings } : {}),
        });
      },
    );
  }

  return server;
}
