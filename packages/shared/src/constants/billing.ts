/**
 * 課金プランの定数 (FE/BE 共通)
 * 設計書 §7.2 / PRD §4.1.12b (FR-BILL-01, 02)
 *
 * 命名について (設計書 §7.2.3):
 *   TRAKON では `Plan` は既に「予定 (スケジュール)」を指す物理テーブル名・
 *   ドメイン用語として占有されている (plans / PlanDTO / features/plans)。
 *   課金プランは必ず `BillingPlan*` / `plan_code` と表記し、単独の `Plan` を使わない。
 *
 * Price ID をここに置かない理由:
 *   本番とテストで値が異なり、混在させると請求事故になる。環境変数のみで扱う
 *   (STRIPE_PERSONAL_MONTHLY_PRICE_ID / STRIPE_TEAM_MONTHLY_PRICE_ID)。
 */

export const BILLING_PLAN_CODES = ['free', 'personal', 'team', 'enterprise'] as const;

export type BillingPlanCode = (typeof BILLING_PLAN_CODES)[number];

export type BillingPlanSpec = {
  code: BillingPlanCode;
  label: string;
  /** 月額 (税込)。null は個別見積 */
  monthlyPriceJpyIncTax: number | null;
  /** 会員アカウント数の上限。null は無制限 */
  seatLimit: number | null;
  /** プロジェクト数の上限。null は無制限 */
  projectLimit: number | null;
  /** 無料トライアル時間。null はトライアルなし */
  trialHours: number | null;
  /** Stripe の Customer / Subscription を作るか */
  stripeManaged: boolean;
};

export const BILLING_PLANS: Record<BillingPlanCode, BillingPlanSpec> = {
  free: {
    code: 'free',
    label: 'Free',
    monthlyPriceJpyIncTax: 0,
    seatLimit: 1,
    projectLimit: 2,
    trialHours: null,
    stripeManaged: false,
  },
  personal: {
    code: 'personal',
    label: 'Personal',
    monthlyPriceJpyIncTax: 980,
    seatLimit: 1,
    projectLimit: 10,
    trialHours: 120,
    stripeManaged: true,
  },
  team: {
    // 正式名称は「Team」。"Teams" ではない (Stripe 実装仕様書 §2)
    code: 'team',
    label: 'Team',
    monthlyPriceJpyIncTax: 9800,
    seatLimit: 5,
    projectLimit: null,
    trialHours: 120,
    stripeManaged: true,
  },
  enterprise: {
    // Phase 1 以降。plan_code として定義するのみで、契約管理は未実装 (設計書 §7.13 論点 7)
    code: 'enterprise',
    label: 'Enterprise',
    monthlyPriceJpyIncTax: null,
    seatLimit: null,
    projectLimit: null,
    trialHours: null,
    stripeManaged: false,
  },
};

/** ユーザーが自分で申し込めるプラン (画面の比較表に出す順) */
export const SELECTABLE_BILLING_PLAN_CODES = ['free', 'personal', 'team'] as const;

export type SelectableBillingPlanCode = (typeof SELECTABLE_BILLING_PLAN_CODES)[number];

/**
 * Stripe の subscription status に 'none' (Stripe 未連携 = Free) を加えたもの。
 * DB の billing_subscriptions.status の許容値と一致させる。
 */
export const SUBSCRIPTION_STATUSES = [
  'none',
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'paused',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Stripe 上に「生きている契約」がある状態。
 *
 * ここに含まれない状態 (none / canceled / incomplete_expired) では、解約・
 * 解約取り消し・プラン変更を呼んでも Stripe 側に対象が無く失敗する。
 * 画面の導線と API の前提を同じ定義で判断するため shared に置く (設計書 §7.7)。
 */
export const LIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'incomplete',
  'paused',
];

export function hasLiveSubscription(status: SubscriptionStatus): boolean {
  return LIVE_SUBSCRIPTION_STATUSES.includes(status);
}

/** 組織ロール。課金操作の可否を決める (プロジェクトロールとは別系統) */
export const ORG_ROLES = ['owner', 'admin', 'member'] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'オーナー',
  admin: '管理者',
  member: 'メンバー',
};

/** 課金操作 (プラン契約・変更・解約・支払方法変更・組織メンバー管理) を行える組織ロール */
export const BILLING_CAPABLE_ORG_ROLES: readonly OrgRole[] = ['owner', 'admin'];

export function canManageBilling(role: OrgRole): boolean {
  return BILLING_CAPABLE_ORG_ROLES.includes(role);
}

/**
 * 支払い失敗後の猶予日数。Stripe 本番のスマートリトライ設定 (7日間・最大4回) に対応する
 * (設計書 §7.10.1)。
 */
export const PAST_DUE_GRACE_DAYS = 7;

/**
 * Checkout の subscription_data.trial_period_days に渡す値。
 * Stripe の 5 日間は 5 x 24 = 120 時間として扱われ、事業要件の「120 時間」と一致する。
 * trial_end は使わない (Checkout Session 作成〜申込完了の時間差だけ短縮されるため)。
 */
export const TRIAL_PERIOD_DAYS = 5;

/** トライアル時間 (120h)。表示・検証用 */
export const TRIAL_PERIOD_HOURS = TRIAL_PERIOD_DAYS * 24;
