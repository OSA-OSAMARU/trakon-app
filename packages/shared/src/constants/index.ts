export const APP_NAME = 'TRAKON' as const;
export const API_VERSION = 'v1' as const;
export const API_BASE_PATH = `/api/${API_VERSION}` as const;

/**
 * 退会理由 (issue #95)。退会 Confirm 画面のラジオボタン選択肢として FE で描画し、
 * value を DELETE /auth/me の body で受けて audit_logs.extra.reason に保存する。
 * FE/BE で値定義を一元化するため shared に置く。
 */
export const WITHDRAWAL_REASONS = [
  { value: 'not_using', label: '使わなくなった' },
  { value: 'missing_features', label: '機能が不足している' },
  { value: 'hard_to_use', label: '操作が難しい' },
  { value: 'switching_tool', label: '他のツールに移行' },
  { value: 'temporary_break', label: '一時的に利用を停止' },
  { value: 'other', label: 'その他' },
] as const;

export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number]['value'];

/**
 * 参加者の職種マスタ (Figma node 79:2 / 18 種)。
 *
 * 表示名には略語を付けず正式名称を使う。選択肢は後から追加できる前提だが、
 * 値は DB の CHECK 制約と対応するため、追加時はマイグレーションも併せて行う。
 * FE の選択肢と BE の検証で同じ定義を使うため shared に置く。
 */
export const JOB_TITLES = [
  'producer',
  'planner',
  'project_manager',
  'director',
  'art_director',
  'technical_director',
  'designer',
  'web_designer',
  'ui_ux_designer',
  'engineer',
  'frontend_engineer',
  'backend_engineer',
  'coder',
  'writer',
  'photographer',
  'marketer',
  'account',
  'other',
] as const;

export type JobTitle = (typeof JOB_TITLES)[number];

export const JOB_TITLE_LABEL: Record<JobTitle, string> = {
  producer: 'プロデューサー',
  planner: 'プランナー',
  project_manager: 'プロジェクトマネージャー',
  director: 'ディレクター',
  art_director: 'アートディレクター',
  technical_director: 'テクニカルディレクター',
  designer: 'デザイナー',
  web_designer: 'Webデザイナー',
  ui_ux_designer: 'UI/UXデザイナー',
  engineer: 'エンジニア',
  frontend_engineer: 'フロントエンドエンジニア',
  backend_engineer: 'バックエンドエンジニア',
  coder: 'コーダー',
  writer: 'ライター',
  photographer: 'フォトグラファー',
  marketer: 'マーケター',
  account: 'アカウント',
  other: 'その他',
};

/**
 * 参加者の区分マスタ (Figma node 79:2 / 3 種)。プロジェクトとの関係を表す。
 *
 * `production` / `client` は既存の 2 値をそのまま引き継ぎ、`partner` を追加した。
 * ラベルは Figma の表記 (制作チーム / クライアント / 外部パートナー) に合わせる。
 */
export const MEMBER_TYPES = ['production', 'client', 'partner'] as const;

export type MemberType = (typeof MEMBER_TYPES)[number];

export const MEMBER_TYPE_LABEL: Record<MemberType, string> = {
  production: '制作チーム',
  client: 'クライアント',
  partner: '外部パートナー',
};

/**
 * 予定のカテゴリマスタ (工程の種別)。
 *
 * 工程の流れに沿った順に並べる (提案 → ワイヤーフレーム → デザイン → コーディング)。
 * 選択肢の並び順もこの配列順をそのまま使う。
 *
 * FE の選択肢・BE の Zod 検証・DB の CHECK 制約で同じ定義を使うため shared に置く
 * (以前は server/schemas/plans.ts・features/plans/api.ts・services/dashboard.ts・
 * migration の 4 箇所に重複していた)。
 */
export const PLAN_CATEGORIES = [
  'proposal',
  'wireframe',
  'design',
  'coding',
  'review',
  'meeting',
  'other',
] as const;

export type PlanCategory = (typeof PLAN_CATEGORIES)[number];

/** 正式名称。選択肢・詳細表示で使う。 */
export const PLAN_CATEGORY_LABEL: Record<PlanCategory, string> = {
  proposal: '提案',
  wireframe: 'ワイヤーフレーム',
  design: 'デザイン',
  coding: 'コーディング',
  review: 'レビュー',
  meeting: '打ち合わせ',
  other: 'その他',
};

/**
 * スケジュールカード上の短縮名。
 * カード幅が狭く正式名称が入りきらないため、長いものだけ縮めた別名を持つ。
 */
export const PLAN_CATEGORY_SHORT_LABEL: Record<PlanCategory, string> = {
  proposal: '提案',
  wireframe: 'ワイヤー',
  design: 'デザイン',
  coding: 'コーディング',
  review: 'レビュー',
  meeting: '打ち合わせ',
  other: 'その他',
};

/**
 * スケジュールカードのカラーテーマ (Figma node 54:2 / 10 種)。
 *
 * 色は「状態」を表すものではなく、**ユーザーがスケジュールを視覚整理するために選ぶもの**。
 * 予定ごとに選択できる (plans.color_theme)。未設定のときはカテゴリ由来の既定色に
 * フォールバックする。実際の色値は apps/web の globals.css / scheduleTheme.ts 側にある。
 *
 * FE の選択肢・BE の Zod 検証・DB の CHECK 制約で同じ定義を使うため shared に置く。
 */
export const SCHEDULE_THEMES = [
  'warm-gray',
  'rose',
  'coral',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'violet',
] as const;

export type ScheduleThemeKey = (typeof SCHEDULE_THEMES)[number];
