import { useMemo, useState } from 'react';
import { addDays, differenceInDays, parseISO } from 'date-fns';

import type { Plan } from '@/features/plans/api';
import { ScheduleBoard, ZoomControl } from '@/features/plans/schedule';
import { ROW_HEIGHT_DEFAULT } from '@/features/plans/scheduleLayout';

type ShareItem = { id: string; name: string };

/**
 * 共有リンク (非会員) 向けスケジュールカレンダー。
 *
 * 描画は認証済み画面と同じ ScheduleBoard を閲覧専用モードで使う。
 * ドラッグ移動 / 作成はできない。#131 でクライアントの確認/承認/差し戻し操作を
 * 追加したため、ボールをクリックすると操作モーダル (onSelectPlan) が開く。
 */
export function ShareSchedule({
  project,
  items,
  plans,
  onSelectPlan,
}: {
  project: { startDate: string; endDate: string };
  items: ShareItem[];
  plans: Plan[];
  onSelectPlan?: (plan: Plan) => void;
}) {
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT_DEFAULT);

  const days = useMemo(() => {
    const start = parseISO(project.startDate);
    const end = parseISO(project.endDate);
    const count = Math.max(0, differenceInDays(end, start) + 1);
    return Array.from({ length: count }, (_, i) => addDays(start, i));
  }, [project.startDate, project.endDate]);

  const plansByItem = useMemo(() => {
    const map = new Map<string, Plan[]>();
    for (const p of plans) {
      const arr = map.get(p.itemId) ?? [];
      arr.push(p);
      map.set(p.itemId, arr);
    }
    return map;
  }, [plans]);

  if (days.length === 0) {
    return (
      <p className="m-8 text-sm text-muted-foreground">プロジェクト期間が設定されていません。</p>
    );
  }
  if (items.length === 0) {
    return <p className="m-8 text-sm text-muted-foreground">表示できる制作物がありません。</p>;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ScheduleBoard
        days={days}
        items={items}
        plansByItem={plansByItem}
        rowHeight={rowHeight}
        onSelectPlan={onSelectPlan}
        className="min-h-0"
      />
      <ZoomControl rowHeight={rowHeight} onChange={setRowHeight} />
    </div>
  );
}
