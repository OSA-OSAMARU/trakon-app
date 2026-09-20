import { addMonths, format, parseISO, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';

import type { Plan } from '../api';
import { planCardStyle } from '../planTheme';
import { isOverdue } from '../scheduleLayout';
import { computeDayTones } from '../schedule/dayTones';
import { buildMonthGrid, isEmptyMonth, splitDayPlans, type CalendarDay } from './calendarLayout';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 月表示カレンダー (#66)。**閲覧専用**。
 *
 * 縦型スケジュールが「工程の連なりと受け渡し」を見るものなのに対し、
 * ここは「今月なにがあるか」に答える。用途が重ならないので両方を持つ意味がある。
 *
 * 閲覧専用にしているのは、縦型が持つドラッグでの日程変更・後続の紐付けを
 * ここへ持ち込むと**同じ操作の実装が 2 系統**になり、片方だけ直る事故が起きるため。
 * カードを押せば既存のボール詳細が開くので、そこから先の操作は 1 箇所に集約される。
 *
 * **停滞 (期限超過) を最優先で目立たせる。** 月のどこに滞りが固まっているかが
 * 一目で分かることが、ただの月間カレンダーではなく TRAKON の月表示である理由。
 */
export function CalendarMonthView({
  plans,
  itemNameById,
  today,
  initialMonth,
  onSelectPlan,
}: {
  plans: Plan[];
  /** 制作物名の索引。チップに出して「どの列の予定か」を保つ */
  itemNameById: Map<string, string>;
  today: Date;
  /** 初期表示月。プロジェクト期間内の今日、または期間の開始月 */
  initialMonth: Date;
  onSelectPlan: (plan: Plan) => void;
}) {
  const [month, setMonth] = useState<Date>(startOfMonth(initialMonth));

  const weeks = useMemo(
    () => buildMonthGrid({ month, plans, today }),
    [month, plans, today],
  );

  const monthOverdue = useMemo(
    () =>
      // 同じ予定が複数日に跨るので、件数は予定単位で数える
      new Set(
        weeks
          .flat()
          .filter((d) => d.inMonth)
          .flatMap((d) => d.plans.filter((p) => isOverdue(p, today)).map((p) => p.id)),
      ).size,
    [weeks, today],
  );

  const empty = isEmptyMonth(weeks);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-8 pb-8">
      <div className="flex items-center gap-2 py-4">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="前の月"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          <ChevronLeft className="size-5" />
        </Button>
        <span aria-live="polite" className="text-heading-section font-semibold">
          {format(month, 'yyyy年M月')}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="次の月"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMonth(startOfMonth(today))}
          className="ml-1"
        >
          今月
        </Button>

        {/* 停滞の総量を先に言う。グリッドを走査しなくても「今月は滞っている」が分かる */}
        {monthOverdue > 0 && (
          <span className="text-danger ml-auto flex items-center gap-1.5 text-label font-medium">
            <TriangleAlert className="size-4" aria-hidden />
            期限超過 {monthOverdue} 件
          </span>
        )}
      </div>

      <div className="border-border min-h-0 flex-1 overflow-auto rounded-xl border">
        <div className="text-text-tertiary border-border grid grid-cols-7 border-b text-center text-label">
          {WEEKDAYS.map((w, i) => (
            <span
              key={w}
              className={cn('py-2', i === 0 && 'text-holiday-foreground', i === 6 && 'text-text-secondary')}
            >
              {w}
            </span>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="border-border grid grid-cols-7 border-b last:border-b-0">
            {week.map((day) => (
              <DayCell
                key={day.iso}
                day={day}
                today={today}
                itemNameById={itemNameById}
                onSelectPlan={onSelectPlan}
              />
            ))}
          </div>
        ))}
      </div>

      {empty && (
        <p className="text-text-tertiary mt-3 text-label">この月に予定はありません。</p>
      )}
    </div>
  );
}

function DayCell({
  day,
  today,
  itemNameById,
  onSelectPlan,
}: {
  day: CalendarDay;
  today: Date;
  itemNameById: Map<string, string>;
  onSelectPlan: (plan: Plan) => void;
}) {
  // 週末・祝日・今日のトーンは縦型と同じ判定を使う (見え方を揃える)
  const [tone] = computeDayTones([day.date], today);
  const { visible, hiddenCount } = splitDayPlans(day.plans);

  return (
    <div
      className={cn(
        'border-border min-h-[110px] border-r p-1.5 last:border-r-0',
        tone!.tone,
        // 当月外は一段落として、今月の形が浮き上がるようにする
        !day.inMonth && 'opacity-45',
      )}
    >
      <div className="flex items-center gap-1 px-1 pb-1">
        <span
          className={cn(
            'text-label',
            tone!.today
              ? 'bg-brand text-brand-foreground flex size-6 items-center justify-center rounded-full font-semibold'
              : tone!.text,
          )}
        >
          {day.date.getDate()}
        </span>
        {/* その日に滞っている件数。セル単位でも停滞が見えるようにする */}
        {day.overdueCount > 0 && (
          <span
            className="text-danger ml-auto flex items-center gap-0.5 text-micro font-medium"
            title={`期限超過 ${day.overdueCount} 件`}
          >
            <TriangleAlert className="size-3" aria-hidden />
            {day.overdueCount}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {visible.map((plan) => (
          <PlanChip
            key={plan.id}
            plan={plan}
            today={today}
            itemName={itemNameById.get(plan.itemId)}
            onSelect={() => onSelectPlan(plan)}
          />
        ))}
        {hiddenCount > 0 && (
          <span className="text-text-tertiary px-1 text-micro">他 {hiddenCount} 件</span>
        )}
      </div>
    </div>
  );
}

function PlanChip({
  plan,
  today,
  itemName,
  onSelect,
}: {
  plan: Plan;
  today: Date;
  itemName: string | undefined;
  onSelect: () => void;
}) {
  const theme = planCardStyle(plan.category, plan.colorTheme);
  const overdue = isOverdue(plan, today);
  const done = plan.status === 'completed' || plan.ballState === 'tossed';

  return (
    <button
      type="button"
      onClick={onSelect}
      // 日付と制作物まで読み上げないと、同名の予定が並んだとき区別できない
      aria-label={`${format(parseISO(plan.scheduledDate), 'M月d日')} ${plan.title}${
        itemName ? ` / ${itemName}` : ''
      }${overdue ? ' (期限超過)' : ''}`}
      className={cn(
        'flex w-full items-center gap-1 rounded-md border px-1.5 py-1 text-left transition-opacity hover:opacity-80',
        theme.surface,
        // 期限超過は色より先に目に入るよう、太い赤枠で囲う
        overdue ? 'border-danger border-2' : theme.border,
        done && 'opacity-60',
      )}
    >
      <span className={cn('h-3 w-0.5 shrink-0 rounded-full', theme.stripe)} aria-hidden />
      <span className="text-plan-foreground min-w-0 flex-1 truncate text-micro font-medium">
        {plan.title}
      </span>
      {plan.ballHolder && (
        <span className="text-plan-foreground/70 shrink-0 text-micro">
          {plan.ballHolder.name.slice(0, 3)}
        </span>
      )}
    </button>
  );
}
