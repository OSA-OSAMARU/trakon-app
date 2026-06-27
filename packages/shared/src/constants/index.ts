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
