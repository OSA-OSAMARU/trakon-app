/**
 * 利用権限 (Entitlement) の単一判定関数 (FE/BE 共通)
 * 設計書 §7.6 / PRD §4.1.12b (FR-BILL-06)
 *
 * 【確定要件】契約状態 (subscription_status) 単体で権限を判定してはならない。
 * 以下 5 要素を組み合わせた単一の判定関数を実装し、アプリ全体で共用する:
 *   1. plan_code
 *   2. 契約状態
 *   3. 解約予約 (cancel_at_period_end) と請求期間終了日
 *   4. 支払猶予期限
 *   5. プランごとの会員アカウント数・プロジェクト数の上限
 *
 * Date / DB / Prisma に依存しない純関数として実装する (ballHolder.ts と同じ流儀)。
 * FE は BE が返した判定結果をそのまま表示に使い、**再計算しない** (§7.6.4)。
 */

import {
  BILLING_PLANS,
  type BillingPlanCode,
  type SubscriptionStatus,
} from '../constants/billing.js';

export type EntitlementInput = {
  planCode: BillingPlanCode;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | Date | null;
  gracePeriodEndsAt: string | Date | null;
  /** 会員アカウント数 (有効な組織メンバー + 未受諾かつ有効期限内の招待) */
  seatCount: number;
  /** 未削除・未アーカイブのプロジェクト数 */
  projectCount: number;
  /** テスト用に注入可能。既定は現在時刻 */
  now?: Date;
};

/** 権限レベル。`blocked` は将来の停止措置用で、現時点では返さない */
export type EntitlementLevel = 'full' | 'read_only' | 'blocked';

export type EntitlementReason =
  /** Free プラン (Stripe 未連携) */
  | 'free'
  /** 有料プランのトライアル中 */
  | 'trialing'
  /** 有料プランが有効 */
  | 'active'
  /** 支払い失敗後の猶予期間中。利用は継続できる */
  | 'in_grace_period'
  /** 猶予期間が切れた */
  | 'grace_expired'
  /** 再試行がすべて失敗した */
  | 'unpaid'
  /** 契約が停止されている */
  | 'paused'
  /** 解約済み。Free 相当へ落ちる */
  | 'canceled'
  /** 解約予約済みだが請求期間内。有料権限は維持する */
  | 'canceled_pending'
  /** 初回決済が完了していない。有料権限は付与しない */
  | 'incomplete';

export type EntitlementLimits = {
  seatLimit: number | null;
  projectLimit: number | null;
};

export type Entitlement = {
  level: EntitlementLevel;
  reason: EntitlementReason;
  /** 契約プラン (表示用) */
  planCode: BillingPlanCode;
  /**
   * 契約状態を踏まえた「実効プラン」。解約済み・手続き未完了などでは free に落ちる。
   * **上限判定には必ずこちらを使う。**
   */
  effectivePlanCode: BillingPlanCode;
  limits: EntitlementLimits;
  usage: { seatCount: number; projectCount: number };
  /** 上限の超過数。0 なら余裕あり */
  over: { seats: number; projects: number };
  canCreateProject: boolean;
  canInviteMember: boolean;
  /** 支払猶予の期限 (ISO 文字列)。猶予中でなければ null */
  graceEndsAt: string | null;
  /** 現在の請求期間の終了日時 (ISO 文字列) */
  periodEndsAt: string | null;
  /** 画面にそのまま出せる日本語の一文 */
  message: string;
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function overBy(count: number, limit: number | null): number {
  if (limit === null) return 0;
  return Math.max(0, count - limit);
}

/**
 * 契約状態から「実効プラン」と権限レベルの素案を決める。
 * 上限による調整はここでは行わない (凍結はプロジェクト単位で表現するため)。
 */
function resolveStatus(input: {
  planCode: BillingPlanCode;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  gracePeriodEndsAt: Date | null;
  now: Date;
}): { level: EntitlementLevel; reason: EntitlementReason; effectivePlanCode: BillingPlanCode } {
  const { planCode, status, cancelAtPeriodEnd, currentPeriodEnd, gracePeriodEndsAt, now } = input;

  // 解約予約済み: 請求期間の終了までは有料権限を維持し、終了後は free へ落とす。
  // Webhook の遅延に対する保険。**時刻だけを根拠に昇格はしないが、降格はする** (安全側)。
  const canceledPending =
    cancelAtPeriodEnd && (status === 'trialing' || status === 'active' || status === 'past_due');
  if (canceledPending) {
    if (currentPeriodEnd && now.getTime() >= currentPeriodEnd.getTime()) {
      return { level: 'full', reason: 'canceled', effectivePlanCode: 'free' };
    }
    return { level: 'full', reason: 'canceled_pending', effectivePlanCode: planCode };
  }

  switch (status) {
    case 'trialing':
      return { level: 'full', reason: 'trialing', effectivePlanCode: planCode };

    case 'active':
      return { level: 'full', reason: 'active', effectivePlanCode: planCode };

    case 'past_due': {
      // 猶予期間中は通常どおり利用できる (FR-BILL-10)。
      // 支払いの一時的な失敗で即座に業務が止まると TRAKON が進行を止める側になってしまう。
      const inGrace = gracePeriodEndsAt !== null && now.getTime() < gracePeriodEndsAt.getTime();
      return inGrace
        ? { level: 'full', reason: 'in_grace_period', effectivePlanCode: planCode }
        : { level: 'read_only', reason: 'grace_expired', effectivePlanCode: planCode };
    }

    case 'unpaid':
      return { level: 'read_only', reason: 'unpaid', effectivePlanCode: planCode };

    case 'paused':
      return { level: 'read_only', reason: 'paused', effectivePlanCode: planCode };

    case 'canceled':
      return { level: 'full', reason: 'canceled', effectivePlanCode: 'free' };

    case 'incomplete':
    case 'incomplete_expired':
      // 初回決済が完了していない。有料権限は付与せず Free として扱う
      return { level: 'full', reason: 'incomplete', effectivePlanCode: 'free' };

    case 'none':
    default:
      return { level: 'full', reason: 'free', effectivePlanCode: 'free' };
  }
}

function buildMessage(input: {
  level: EntitlementLevel;
  reason: EntitlementReason;
  effectivePlanCode: BillingPlanCode;
  over: { seats: number; projects: number };
}): string {
  const planLabel = BILLING_PLANS[input.effectivePlanCode].label;

  switch (input.reason) {
    case 'in_grace_period':
      return 'お支払いを確認できませんでした。お支払い方法を更新してください。';
    case 'grace_expired':
    case 'unpaid':
      return 'お支払いが確認できないため、編集を停止しています。お支払い方法を更新すると再開できます。';
    case 'paused':
      return '契約が停止中のため、閲覧のみ可能です。';
    case 'incomplete':
      return 'お支払い手続きが完了していません。完了するとプランが有効になります。';
    case 'canceled_pending':
      return '解約予定です。現在の請求期間の終了まで利用できます。';
    case 'trialing':
      return `${planLabel} プランの無料トライアル中です。`;
    default:
      break;
  }

  if (input.over.projects > 0) {
    return `${planLabel} プランの上限を超えているため、${input.over.projects} 件のプロジェクトが閲覧のみになっています。`;
  }
  if (input.over.seats > 0) {
    return `${planLabel} プランの会員アカウント上限を超えています。`;
  }
  return `${planLabel} プランを利用中です。`;
}

/**
 * 利用権限の判定。**アプリ全体でこの関数だけを使う。**
 */
export function evaluateEntitlement(input: EntitlementInput): Entitlement {
  const now = input.now ?? new Date();
  const currentPeriodEnd = toDate(input.currentPeriodEnd);
  const gracePeriodEndsAt = toDate(input.gracePeriodEndsAt);

  const resolved = resolveStatus({
    planCode: input.planCode,
    status: input.status,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    currentPeriodEnd,
    gracePeriodEndsAt,
    now,
  });

  const spec = BILLING_PLANS[resolved.effectivePlanCode];
  const limits: EntitlementLimits = {
    seatLimit: spec.seatLimit,
    projectLimit: spec.projectLimit,
  };

  const over = {
    seats: overBy(input.seatCount, limits.seatLimit),
    projects: overBy(input.projectCount, limits.projectLimit),
  };

  // 上限超過は全体を read_only にしない。凍結はプロジェクト単位で表現する (§7.11)
  const writable = resolved.level === 'full';
  const canCreateProject =
    writable && (limits.projectLimit === null || input.projectCount < limits.projectLimit);
  const canInviteMember =
    writable && (limits.seatLimit === null || input.seatCount < limits.seatLimit);

  return {
    level: resolved.level,
    reason: resolved.reason,
    planCode: input.planCode,
    effectivePlanCode: resolved.effectivePlanCode,
    limits,
    usage: { seatCount: input.seatCount, projectCount: input.projectCount },
    over,
    canCreateProject,
    canInviteMember,
    graceEndsAt: resolved.reason === 'in_grace_period' ? toIso(gracePeriodEndsAt) : null,
    periodEndsAt: toIso(currentPeriodEnd),
    message: buildMessage({ ...resolved, over }),
  };
}

/** 未契約 (Free) の既定値。組織にサブスクリプション行がない場合のフォールバック */
export const FREE_SUBSCRIPTION_DEFAULTS = {
  planCode: 'free' as BillingPlanCode,
  status: 'none' as SubscriptionStatus,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  gracePeriodEndsAt: null,
};
