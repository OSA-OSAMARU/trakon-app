import { prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';

/**
 * プロジェクト期間と予定日程の整合 (#155)。
 *
 * 縦型スケジュール (SC-06) は行軸をプロジェクトの startDate..endDate から組み立てるため、
 * 期間の外に出た予定は描画先の行が無い。FE 側の dayIndex() が端の行へクランプするので
 * 「消える」代わりに**間違った日付の位置に潰れて描画される**という直りにくい壊れ方をする。
 *
 * そこで両方向を塞ぐ:
 *   - プロジェクト期間の変更で既存予定がはみ出す   → 409 PLANS_OUT_OF_RANGE
 *   - 予定の日付をプロジェクト期間の外へ動かす     → 422 PLAN_OUT_OF_PROJECT_PERIOD
 */

/** YYYY-MM-DD (DATE 列は時刻を持たないので UTC 日付をそのまま使う)。 */
export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type PlanDateRange = {
  /** 最も早い開始日 */
  min: string;
  /** 最も遅い終了日 (dueDate 未設定の予定は scheduledDate を終了日とみなす) */
  max: string;
  /** 対象になった予定の件数 */
  count: number;
};

/**
 * プロジェクト配下の有効な予定が占める日付範囲。予定が 1 件も無ければ null。
 *
 * 予定の期間は [scheduledDate, dueDate ?? scheduledDate]。DB の ck_plans_due_date_range が
 * `due_date >= scheduled_date` を保証しているので、
 * max(COALESCE(due, sched)) は max(max(due), max(sched)) と一致する。
 * これにより COALESCE 無しの集約 1 回で求められる。
 */
export async function getPlanDateRange(projectId: string): Promise<PlanDateRange | null> {
  const agg = await prisma.plan.aggregate({
    where: {
      deletedAt: null,
      // 取り消した予定は日程の制約にしない
      status: { not: 'canceled' },
      item: { projectId, deletedAt: null },
    },
    _min: { scheduledDate: true },
    _max: { scheduledDate: true, dueDate: true },
    _count: { _all: true },
  });

  const min = agg._min.scheduledDate;
  const maxScheduled = agg._max.scheduledDate;
  if (!min || !maxScheduled) return null;

  const maxDue = agg._max.dueDate;
  const max = maxDue && maxDue > maxScheduled ? maxDue : maxScheduled;

  return { min: toDateOnly(min), max: toDateOnly(max), count: agg._count._all };
}

function formatJa(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}

/**
 * 変更後のプロジェクト期間が既存予定をすべて含むか検証する。
 * はみ出す予定があれば 409 PLANS_OUT_OF_RANGE を投げる。
 */
export async function assertPeriodCoversPlans(input: {
  projectId: string;
  startDate: string;
  endDate: string;
}): Promise<void> {
  const range = await getPlanDateRange(input.projectId);
  if (!range) return;
  if (range.min >= input.startDate && range.max <= input.endDate) return;

  // 失敗時だけ「何件はみ出すか」を数える (通常経路にクエリを増やさない)
  const outOfRangeCount = await prisma.plan.count({
    where: {
      deletedAt: null,
      status: { not: 'canceled' },
      item: { projectId: input.projectId, deletedAt: null },
      OR: [
        { scheduledDate: { lt: new Date(`${input.startDate}T00:00:00Z`) } },
        { scheduledDate: { gt: new Date(`${input.endDate}T00:00:00Z`) } },
        { dueDate: { gt: new Date(`${input.endDate}T00:00:00Z`) } },
      ],
    },
  });

  throw new ApiException(
    'PLANS_OUT_OF_RANGE',
    409,
    `予定が期間外になるため変更できません。登録済みの予定は ${formatJa(range.min)}〜${formatJa(range.max)} の範囲にあり、${outOfRangeCount} 件がはみ出します。`,
    {
      planRange: range,
      requestedPeriod: { startDate: input.startDate, endDate: input.endDate },
      outOfRangeCount,
    },
  );
}

/**
 * 予定の日付がプロジェクト期間に収まっているか検証する。
 * 外れていれば 422 PLAN_OUT_OF_PROJECT_PERIOD を投げる。
 *
 * 日付を変更しない更新では呼ばない。既存データに期間外の予定が残っている場合に、
 * 無関係な項目 (予定名など) の編集まで塞いでしまわないようにするため。
 */
export async function assertPlanWithinProjectPeriod(input: {
  projectId: string;
  scheduledDate: string;
  dueDate: string | null;
}): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, deletedAt: null },
    select: { startDate: true, endDate: true },
  });
  if (!project) throw new ApiException('NOT_FOUND', 404, 'Project not found.');

  const start = toDateOnly(project.startDate);
  const end = toDateOnly(project.endDate);
  const planEnd = input.dueDate ?? input.scheduledDate;

  if (input.scheduledDate >= start && planEnd <= end) return;

  throw new ApiException(
    'PLAN_OUT_OF_PROJECT_PERIOD',
    422,
    `予定はプロジェクト期間 ${formatJa(start)}〜${formatJa(end)} の中に収めてください。`,
    { projectPeriod: { startDate: start, endDate: end } },
  );
}
