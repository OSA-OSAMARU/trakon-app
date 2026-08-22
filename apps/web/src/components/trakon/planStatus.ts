import { CheckCircle2, Circle, CircleDot, Clock, RotateCcw } from 'lucide-react';

/**
 * 予定の状態表示の定義 (Figma node 11:19 / 11:46 / 11:73 / 11:100 / 19:19)。
 * ボール状態機械 6 値 (packages/shared の PlanState) と 1:1 で対応する。
 */
export type PlanStatus =
  | 'in_progress'
  | 'review_pending'
  | 'approved'
  | 'tossed'
  | 'sent_back'
  | 'completed';

export const PLAN_STATUSES = [
  'in_progress',
  'review_pending',
  'approved',
  'tossed',
  'sent_back',
  'completed',
] as const satisfies readonly PlanStatus[];

export const PLAN_STATUS_SPEC: Record<
  PlanStatus,
  { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger'; Icon: typeof Circle }
> = {
  in_progress: { label: '進行中', variant: 'warning', Icon: Clock },
  review_pending: { label: '確認待ち', variant: 'neutral', Icon: CircleDot },
  approved: { label: '承認済み', variant: 'success', Icon: CheckCircle2 },
  tossed: { label: '待機中', variant: 'neutral', Icon: Circle },
  sent_back: { label: '差し戻し', variant: 'danger', Icon: RotateCcw },
  completed: { label: 'FIX', variant: 'success', Icon: CheckCircle2 },
};

export function planStatusLabel(status: PlanStatus): string {
  return PLAN_STATUS_SPEC[status].label;
}
