import type { Plan } from '../api';

/** 列に並べる制作物。ボード描画に必要なのは id と名前だけ。 */
export type ScheduleItemRef = { id: string; name: string };

/** カード本体のドラッグ (移動 / 上下端リサイズ)。 */
export type DragState = {
  plan: Plan;
  mode: 'move' | 'resize-top' | 'resize-bottom';
  startClientY: number;
  dayDelta: number;
  moved: boolean;
  /** move 中にポインタが乗っている制作物列。別制作物なら drop で移動 (#52)。 */
  targetItemId: string | null;
};

/** 後続紐づけドラッグ (カード下部コネクタ → 別カード)。座標はビューポート基準 (client)。 */
export type LinkDrag = {
  source: Plan;
  start: { x: number; y: number };
  pointer: { x: number; y: number };
  targetId: string | null;
};

/** 空セルの縦ドラッグによる期間付き新規作成。 */
export type CreateDrag = { itemId: string; startIdx: number; endIdx: number };

/** 編集操作一式。ボードに渡さなければ閲覧専用になる。 */
export type ScheduleEditing = {
  onOpenCreate: (date: Date, itemId: string, dueDate?: Date) => void;
  onOpenDetail: (planId: string) => void;
  onMove: (plan: Plan, dayDelta: number) => void;
  onMoveToItem: (plan: Plan, targetItemId: string, dayDelta: number) => void;
  onResize: (plan: Plan, edge: 'top' | 'bottom', dayDelta: number) => void;
  onLink: (source: Plan, target: Plan) => void;
  onCopy: (plan: Plan) => void;
  copyingPlanId: string | null;
};
