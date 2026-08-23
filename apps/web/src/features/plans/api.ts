import type { MemberType, ScheduleThemeKey } from '@trakon/shared';

import type { BallEventType, PlanState } from '@trakon/shared';

import { apiRequest } from '@/lib/api';

export type { BallEventType, PlanState };

// =============================================================================
// 型定義 (BE の DTO と対応)
// =============================================================================

export type PlanCategory =
  | 'wireframe'
  | 'design'
  | 'coding'
  | 'review'
  | 'meeting'
  | 'other';

export const PLAN_CATEGORIES: { value: PlanCategory; label: string }[] = [
  { value: 'wireframe', label: 'ワイヤーフレーム' },
  { value: 'design', label: 'デザイン' },
  { value: 'coding', label: 'コーディング' },
  { value: 'review', label: 'レビュー' },
  { value: 'meeting', label: '打ち合わせ' },
  { value: 'other', label: 'その他' },
];

export type MemberRef = {
  id: string;
  name: string;
  organizationName: string;
  memberType: MemberType;
};

export type BallEvent = {
  id: string;
  eventType: BallEventType;
  source: 'human' | 'auto_chain';
  actor: MemberRef | null;
  occurredAt: string;
  note: string | null;
};

export type Plan = {
  id: string;
  itemId: string;
  planType: 'toss';
  title: string;
  category: PlanCategory;
  /** カラーテーマ (#149)。null はカテゴリ由来の既定色 */
  colorTheme: ScheduleThemeKey | null;
  scheduledDate: string; // YYYY-MM-DD
  dueDate: string | null;
  // 役割 (#131)
  executor: MemberRef | null;
  approver: MemberRef | null;
  progressManager: MemberRef | null;
  // TOSS 履歴スナップショット (#131 §14)
  fromMember: MemberRef | null;
  toMember: MemberRef | null;
  successorPlanId: string | null;
  status: 'active' | 'completed' | 'canceled';
  memo: string | null;
  ballHolder: MemberRef | null;
  ballState: PlanState;
  latestEvent: BallEvent | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlanDetail = {
  plan: Plan;
  events: BallEvent[];
};

export type BallActionResult = {
  plan: Plan;
  autoTossed: Plan | null;
};

export type CreatePlanInput = {
  title: string;
  category: PlanCategory;
  /** 未指定ならカテゴリ由来の既定色になる (#149) */
  colorTheme?: ScheduleThemeKey;
  scheduledDate: string;
  dueDate?: string;
  // 役割 (#131)。実施者は実質必須、承認者は任意、進行責任者は未指定なら既定値。
  executorMemberId?: string;
  approverMemberId?: string;
  progressManagerMemberId?: string;
  successorPlanId?: string;
  memo?: string;
};

export type UpdatePlanInput = Partial<{
  title: string;
  category: PlanCategory;
  /** null でカテゴリ由来の既定色に戻す (#149) */
  colorTheme: ScheduleThemeKey | null;
  scheduledDate: string;
  dueDate: string | null;
  executorMemberId: string | null;
  approverMemberId: string | null;
  progressManagerMemberId: string | null;
  // 別制作物へ移動 (#52)
  itemId: string;
  successorPlanId: string | null;
  memo: string | null;
}>;

// =============================================================================
// API client
// =============================================================================

function basePath(projectId: string, itemId: string) {
  return `/projects/${projectId}/items/${itemId}/plans`;
}

export const plansApi = {
  list: (projectId: string, itemId: string, query?: { from?: string; to?: string }) => {
    const sp = new URLSearchParams();
    if (query?.from) sp.set('from', query.from);
    if (query?.to) sp.set('to', query.to);
    const q = sp.toString() ? `?${sp.toString()}` : '';
    return apiRequest<Plan[]>(`${basePath(projectId, itemId)}${q}`);
  },
  /** プロジェクト配下の全制作物を横断したプラン取得 (制作物列スケジュール用)。 */
  listByProject: (projectId: string, query?: { from?: string; to?: string }) => {
    const sp = new URLSearchParams();
    if (query?.from) sp.set('from', query.from);
    if (query?.to) sp.set('to', query.to);
    const q = sp.toString() ? `?${sp.toString()}` : '';
    return apiRequest<Plan[]>(`/projects/${projectId}/plans${q}`);
  },
  get: (projectId: string, itemId: string, planId: string) =>
    apiRequest<PlanDetail>(`${basePath(projectId, itemId)}/${planId}`),
  create: (projectId: string, itemId: string, body: CreatePlanInput) =>
    apiRequest<Plan>(`${basePath(projectId, itemId)}`, { method: 'POST', body }),
  /** 予定を複製する (#51)。同一制作物・同一期間・同内容の ready 状態の新規予定。 */
  copy: (projectId: string, itemId: string, planId: string) =>
    apiRequest<Plan>(`${basePath(projectId, itemId)}/${planId}/copy`, { method: 'POST', body: {} }),
  update: (projectId: string, itemId: string, planId: string, body: UpdatePlanInput) =>
    apiRequest<Plan>(`${basePath(projectId, itemId)}/${planId}`, { method: 'PATCH', body }),
  remove: (projectId: string, itemId: string, planId: string) =>
    apiRequest<void>(`${basePath(projectId, itemId)}/${planId}`, { method: 'DELETE' }),
  setSuccessor: (
    projectId: string,
    itemId: string,
    planId: string,
    successorPlanId: string | null,
  ) =>
    apiRequest<Plan>(`${basePath(projectId, itemId)}/${planId}/successor`, {
      method: 'PATCH',
      body: { successorPlanId },
    }),
  /** 確認依頼 (実施中 → 確認待ち)。承認者が設定されている予定のみ。 */
  requestReview: (projectId: string, itemId: string, planId: string) =>
    apiRequest<{ plan: Plan }>(`${basePath(projectId, itemId)}/${planId}/request-review`, {
      method: 'POST',
      body: {},
    }),
  undoRequestReview: (projectId: string, itemId: string, planId: string) =>
    apiRequest<{ plan: Plan }>(`${basePath(projectId, itemId)}/${planId}/request-review-undo`, {
      method: 'POST',
      body: {},
    }),
  /** 承認 (→ 承認済み)。承認者、承認者なしなら実施者が実行。後続が無ければ完了。 */
  approve: (projectId: string, itemId: string, planId: string) =>
    apiRequest<BallActionResult>(`${basePath(projectId, itemId)}/${planId}/approve`, {
      method: 'POST',
      body: {},
    }),
  undoApprove: (projectId: string, itemId: string, planId: string) =>
    apiRequest<{ plan: Plan }>(`${basePath(projectId, itemId)}/${planId}/approve-undo`, {
      method: 'POST',
      body: {},
    }),
  /** 差し戻し (承認者 → 実施者)。同一予定内で実施側へ戻す。 */
  sendBack: (projectId: string, itemId: string, planId: string, note?: string) =>
    apiRequest<{ plan: Plan }>(`${basePath(projectId, itemId)}/${planId}/send-back`, {
      method: 'POST',
      body: note ? { note } : {},
    }),
  /** 前工程へ差し戻し (#131 §13)。後続予定から先行予定を再開する。 */
  sendBackToPredecessor: (projectId: string, itemId: string, planId: string, note?: string) =>
    apiRequest<{ plan: Plan; predecessor: Plan }>(
      `${basePath(projectId, itemId)}/${planId}/send-back-to-predecessor`,
      { method: 'POST', body: note ? { note } : {} },
    ),
  /** TOSS (承認済み → TOSS済み)。進行責任者が後続予定へボールを渡す。 */
  toss: (projectId: string, itemId: string, planId: string) =>
    apiRequest<BallActionResult>(`${basePath(projectId, itemId)}/${planId}/toss`, {
      method: 'POST',
      body: {},
    }),
  undoToss: (projectId: string, itemId: string, planId: string) =>
    apiRequest<{ plan: Plan }>(`${basePath(projectId, itemId)}/${planId}/toss-undo`, {
      method: 'POST',
      body: {},
    }),
};

export const plansQueryKey = {
  list: (projectId: string, itemId: string) =>
    ['projects', projectId, 'items', itemId, 'plans'] as const,
  detail: (projectId: string, itemId: string, planId: string) =>
    ['projects', projectId, 'items', itemId, 'plans', planId] as const,
  projectList: (projectId: string) => ['projects', projectId, 'plans'] as const,
};
