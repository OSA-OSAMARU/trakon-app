import { apiRequest } from '@/lib/api';

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
  memberType: 'client' | 'production';
};

export type BallEvent = {
  id: string;
  eventType: 'tossed' | 'completed';
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
  scheduledDate: string; // YYYY-MM-DD
  dueDate: string | null;
  fromMember: MemberRef | null;
  toMember: MemberRef | null;
  successorPlanId: string | null;
  status: 'active' | 'completed' | 'canceled';
  memo: string | null;
  ballHolder: MemberRef | null;
  ballState: 'ready' | 'tossed' | 'completed';
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
  scheduledDate: string;
  dueDate?: string;
  // 実施者/確認者は任意 (#55)
  fromMemberId?: string;
  toMemberId?: string;
  successorPlanId?: string;
  memo?: string;
};

export type UpdatePlanInput = Partial<{
  title: string;
  category: PlanCategory;
  scheduledDate: string;
  dueDate: string | null;
  fromMemberId: string;
  toMemberId: string;
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
  toss: (projectId: string, itemId: string, planId: string, body?: { toMemberId?: string }) =>
    apiRequest<BallActionResult>(`${basePath(projectId, itemId)}/${planId}/toss`, {
      method: 'POST',
      body: body ?? {},
    }),
  complete: (projectId: string, itemId: string, planId: string) =>
    apiRequest<BallActionResult>(`${basePath(projectId, itemId)}/${planId}/complete`, {
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
