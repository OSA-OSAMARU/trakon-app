import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, ListChecks } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/components/ui/utils';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { CATEGORY_STYLE } from '@/features/plans/planTheme';
import {
  dashboardApi,
  dashboardQueryKey,
  type DashboardMemberSection,
  type DashboardTask,
} from '@/features/dashboard/api';

/**
 * SC-09 ダッシュボード (/dashboard)
 * 設計書 §4.4 SC-09 + §3.6 GET /users/me/dashboard
 */
export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: dashboardQueryKey.base(),
    queryFn: () => dashboardApi.get(),
  });

  return (
    <>
      <PageHeader
        width="lg"
        title="ダッシュボード"
        description={
          data
            ? `${format(parseISO(data.today), 'yyyy年 M月d日 (E)', { locale: ja })} 時点で進行中のボール`
            : '今日のボールを集計中…'
        }
      />
      <PageContainer width="lg">
        {isLoading && <Loading />}
      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            ダッシュボードの取得に失敗しました。
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <SummaryCards
            todayCount={data.summary.todayTaskCount}
            overdueCount={data.summary.overdueCount}
          />

          {data.projects.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="size-6 text-emerald-500" />
                今日のタスクはありません。
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-5">
              {data.projects.map((p) => (
                <li key={p.id}>
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <span className="inline-block size-2 rounded-full bg-primary" />
                    <Link to={`/projects/${p.id}/edit`} className="hover:underline">
                      {p.name}
                    </Link>
                    <span className="text-xs font-normal text-muted-foreground">
                      ({p.memberSections.reduce((s, m) => s + m.tasks.length, 0)} 件)
                    </span>
                  </h2>
                  <ul className="space-y-3">
                    {p.memberSections.map((s) => (
                      <li key={s.member.id}>
                        <MemberSection projectId={p.id} section={s} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      </PageContainer>
    </>
  );
}

// -----------------------------------------------------------------------------
function SummaryCards({
  todayCount,
  overdueCount,
}: {
  todayCount: number;
  overdueCount: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card>
        <CardContent className="flex items-center gap-4 py-5">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ListChecks className="size-5" />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">今日のタスク</p>
            <p className="text-2xl font-bold">{todayCount}</p>
          </div>
        </CardContent>
      </Card>
      <Card className={cn(overdueCount > 0 ? 'border-rose-300 bg-rose-50' : '')}>
        <CardContent className="flex items-center gap-4 py-5">
          <span
            className={cn(
              'flex size-10 items-center justify-center rounded-lg',
              overdueCount > 0 ? 'bg-rose-100 text-rose-600' : 'bg-muted text-muted-foreground',
            )}
          >
            <AlertTriangle className="size-5" />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">期限超過</p>
            <p className={cn('text-2xl font-bold', overdueCount > 0 && 'text-rose-700')}>
              {overdueCount}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MemberSection({
  projectId,
  section,
}: {
  projectId: string;
  section: DashboardMemberSection;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="font-medium">{section.member.name}</span>
        <span className="text-muted-foreground">
          ({section.member.organizationName || '—'})
        </span>
        <Badge variant="secondary" className="ml-auto">
          {section.tasks.length} 件
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {section.tasks.map((t) => (
          <TaskCard key={t.planId} projectId={projectId} task={t} />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ projectId, task }: { projectId: string; task: DashboardTask }) {
  const style = CATEGORY_STYLE[task.category];
  return (
    <Link
      to={`/projects/${projectId}/items/${task.itemId}?modal=ball-detail&planId=${task.planId}`}
      className={cn(
        'block rounded-md border px-3 py-2 text-xs transition-colors',
        task.isOverdue
          ? 'border-rose-400 bg-rose-50 text-rose-700 hover:bg-rose-100'
          : `${style.bg} ${style.border} ${style.text} hover:brightness-95`,
      )}
    >
      <div className="mb-1 flex items-center gap-1">
        <Badge variant="secondary" className="px-1 py-0 text-[10px]">
          {style.label}
        </Badge>
        {task.isOverdue && (
          <Badge variant="destructive" className="px-1 py-0 text-[10px]">
            期限超過
          </Badge>
        )}
      </div>
      <p className="line-clamp-2 font-medium">{task.title}</p>
      <p className="mt-0.5 line-clamp-1 text-[11px] opacity-80">{task.itemName}</p>
      {task.dueDate && (
        <p className="mt-1 text-[10px] opacity-70">期日 {task.dueDate}</p>
      )}
    </Link>
  );
}

function Loading() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
