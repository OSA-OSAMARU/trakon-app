import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  differenceInDays,
  format,
  isSameDay,
  isWeekend,
  parseISO,
} from 'date-fns';
import { isHoliday } from '@holiday-jp/holiday_jp';
import { ArrowLeft, Plus, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/components/ui/utils';
import { projectsApi, projectsQueryKey } from '@/features/projects/api';
import { membersApi, membersQueryKey, type ProjectMember } from '@/features/projects/membersApi';
import { plansApi, plansQueryKey, type Plan } from './api';
import { CATEGORY_STYLE } from './categoryColor';
import { PlanModalsHost } from './PlanModalsHost';

/**
 * SC-06 縦型スケジュール (/projects/:projectId/items/:itemId)
 *  - 縦軸: プロジェクト期間内の日付
 *  - 横軸: プロジェクトメンバー (受諾済み + 招待中)
 *  - 予定チップは FROM メンバー列に配置、TO はバッジで明示
 *  - セルクリック → SC-07 作成モーダル / チップクリック → SC-08 詳細モーダル
 */
export function ItemSchedulePage() {
  const { projectId, itemId } = useParams<{ projectId: string; itemId: string }>();
  if (!projectId || !itemId) {
    return <NotFound />;
  }
  return <Inner projectId={projectId} itemId={itemId} />;
}

function Inner({ projectId, itemId }: { projectId: string; itemId: string }) {
  const [, setParams] = useSearchParams();

  const projectQuery = useQuery({
    queryKey: projectsQueryKey.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });
  const itemsQuery = useQuery({
    queryKey: projectsQueryKey.items(projectId),
    queryFn: () => projectsApi.listItems(projectId),
  });
  const membersQuery = useQuery({
    queryKey: membersQueryKey.list(projectId),
    queryFn: () => membersApi.list(projectId),
  });
  const plansQuery = useQuery({
    queryKey: plansQueryKey.list(projectId, itemId),
    queryFn: () => plansApi.list(projectId, itemId),
  });

  const project = projectQuery.data;
  const item = itemsQuery.data?.find((i) => i.id === itemId);
  const members = useMemo(
    () => (membersQuery.data ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [membersQuery.data],
  );
  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);

  const days = useMemo(() => {
    if (!project) return [];
    const start = parseISO(project.startDate);
    const end = parseISO(project.endDate);
    const count = Math.max(0, differenceInDays(end, start) + 1);
    return Array.from({ length: count }, (_, i) => addDays(start, i));
  }, [project]);

  // memberId -> column index
  const memberIndex = useMemo(() => {
    const map = new Map<string, number>();
    members.forEach((m, i) => map.set(m.id, i));
    return map;
  }, [members]);

  // 日付セルごとに「FROM メンバー列に乗せる plans」を割り当て
  const plansByCell = useMemo(() => {
    // key = `${YYYY-MM-DD}|${memberId}`
    const map = new Map<string, Plan[]>();
    for (const p of plans) {
      if (!p.fromMember) continue;
      const key = `${p.scheduledDate}|${p.fromMember.id}`;
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [plans]);

  const loading =
    projectQuery.isLoading ||
    itemsQuery.isLoading ||
    membersQuery.isLoading ||
    plansQuery.isLoading;
  const loadFailed = projectQuery.error || itemsQuery.error || membersQuery.error;

  if (loading) return <PageSkeleton />;
  if (!project || !item || loadFailed) return <NotFound />;

  const openCreateModal = (date: Date, fromMemberId?: string) => {
    setParams(
      (sp) => {
        sp.set('modal', 'create-plan');
        sp.set('date', format(date, 'yyyy-MM-dd'));
        if (fromMemberId) sp.set('fromMemberId', fromMemberId);
        sp.delete('planId');
        return sp;
      },
      { replace: true },
    );
  };
  const openDetailModal = (planId: string) => {
    setParams(
      (sp) => {
        sp.set('modal', 'ball-detail');
        sp.set('planId', planId);
        sp.delete('date');
        sp.delete('fromMemberId');
        return sp;
      },
      { replace: true },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to={`/projects/${projectId}/edit`} className="hover:text-foreground">
              {project.name}
            </Link>
            <span>/</span>
            <span>{item.name}</span>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{item.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/projects/${projectId}/edit`}>
              <ArrowLeft className="size-4" />
              プロジェクト設定へ
            </Link>
          </Button>
          <Button size="sm" onClick={() => openCreateModal(new Date())}>
            <Plus className="size-4" />
            予定を追加
          </Button>
        </div>
      </header>

      {members.length === 0 ? (
        <div className="m-8 rounded-md border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          まずは参加者を追加してください。
          <div className="mt-3">
            <Button size="sm" variant="outline" asChild>
              <Link to={`/projects/${projectId}/members?tab=manage`}>参加者管理を開く</Link>
            </Button>
          </div>
        </div>
      ) : days.length === 0 ? (
        <p className="m-8 text-sm text-muted-foreground">プロジェクト期間が設定されていません。</p>
      ) : (
        <ScheduleGrid
          days={days}
          members={members}
          plansByCell={plansByCell}
          onCellClick={openCreateModal}
          onPlanClick={openDetailModal}
          memberIndex={memberIndex}
        />
      )}

      <PlanModalsHost
        projectId={projectId}
        itemId={itemId}
        members={members}
        plans={plans}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Schedule grid
// -----------------------------------------------------------------------------
function ScheduleGrid({
  days,
  members,
  plansByCell,
  onCellClick,
  onPlanClick,
  memberIndex,
}: {
  days: Date[];
  members: ProjectMember[];
  plansByCell: Map<string, Plan[]>;
  onCellClick: (date: Date, fromMemberId?: string) => void;
  onPlanClick: (planId: string) => void;
  memberIndex: Map<string, number>;
}) {
  const gridStyle = {
    gridTemplateColumns: `100px repeat(${members.length}, minmax(160px, 1fr))`,
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid" style={gridStyle}>
        {/* ヘッダー行 */}
        <div className="sticky top-0 z-20 border-b border-r border-border bg-background" />
        {members.map((m) => (
          <div
            key={m.id}
            className="sticky top-0 z-20 border-b border-r border-border bg-background px-3 py-2 text-xs"
          >
            <div className="font-medium text-foreground">{m.name}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {m.organizationName || '—'}
            </div>
          </div>
        ))}

        {/* 日付行 */}
        {days.map((d) => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const weekend = isWeekend(d);
          const holiday = isHoliday(d);
          const today = isSameDay(d, new Date());
          const cellTone = today
            ? 'bg-amber-50'
            : holiday
              ? 'bg-rose-50/60'
              : weekend
                ? 'bg-slate-50'
                : 'bg-background';
          return (
            <DayRow
              key={dateStr}
              date={d}
              dateStr={dateStr}
              members={members}
              plansByCell={plansByCell}
              cellTone={cellTone}
              today={today}
              holiday={holiday}
              weekend={weekend}
              onCellClick={onCellClick}
              onPlanClick={onPlanClick}
              memberIndex={memberIndex}
            />
          );
        })}
      </div>
    </div>
  );
}

function DayRow({
  date,
  dateStr,
  members,
  plansByCell,
  cellTone,
  today,
  holiday,
  weekend,
  onCellClick,
  onPlanClick,
  memberIndex: _memberIndex,
}: {
  date: Date;
  dateStr: string;
  members: ProjectMember[];
  plansByCell: Map<string, Plan[]>;
  cellTone: string;
  today: boolean;
  holiday: boolean;
  weekend: boolean;
  onCellClick: (date: Date, fromMemberId?: string) => void;
  onPlanClick: (planId: string) => void;
  memberIndex: Map<string, number>;
}) {
  const weekday = format(date, 'EEEEE'); // 短い曜日
  const dayLabel = format(date, 'M/d');
  return (
    <>
      <div
        className={cn(
          'sticky left-0 z-10 flex flex-col items-center justify-center border-b border-r border-border px-2 py-3 text-xs',
          cellTone,
          today && 'font-semibold text-amber-700',
          holiday && 'text-rose-600',
        )}
      >
        <span>{dayLabel}</span>
        <span
          className={cn(
            'text-[10px]',
            weekend ? 'text-slate-500' : 'text-muted-foreground',
            holiday && 'text-rose-500',
          )}
        >
          {weekday}
        </span>
      </div>
      {members.map((m) => {
        const key = `${dateStr}|${m.id}`;
        const cellPlans = plansByCell.get(key) ?? [];
        return (
          <button
            key={key}
            type="button"
            onClick={() => onCellClick(date, m.id)}
            className={cn(
              'group min-h-[64px] border-b border-r border-border p-1 text-left transition-colors',
              cellTone,
              'hover:bg-accent/40',
            )}
          >
            <div className="flex flex-col gap-1">
              {cellPlans.map((p) => (
                <PlanChip
                  key={p.id}
                  plan={p}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlanClick(p.id);
                  }}
                />
              ))}
            </div>
          </button>
        );
      })}
    </>
  );
}

function PlanChip({
  plan,
  onClick,
}: {
  plan: Plan;
  onClick: (e: React.MouseEvent) => void;
}) {
  const style = CATEGORY_STYLE[plan.category];
  const completed = plan.status === 'completed';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
      className={cn(
        'cursor-pointer rounded-md border px-2 py-1 text-xs shadow-sm transition-colors',
        completed
          ? 'border-slate-200 bg-slate-100/80 text-slate-500 line-through'
          : `${style.bg} ${style.border} ${style.text} hover:brightness-95`,
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="line-clamp-1 font-medium">{plan.title}</span>
        {completed && <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[10px] opacity-90">
        <Badge variant="secondary" className="px-1 py-0 text-[10px]">
          {style.label}
        </Badge>
        {plan.toMember && (
          <span className="line-clamp-1">→ {plan.toMember.name}</span>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
function PageSkeleton() {
  return (
    <div className="space-y-3 p-8">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-[60vh] w-full rounded-md" />
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-20 text-center text-sm text-muted-foreground">
      ページが見つかりませんでした。
      <div className="mt-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/projects">プロジェクト一覧へ</Link>
        </Button>
      </div>
    </div>
  );
}
