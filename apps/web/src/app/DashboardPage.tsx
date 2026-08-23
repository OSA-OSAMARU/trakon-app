import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

import {
  BALL_BOARD_COLUMNS,
  BALL_BOARD_COLUMN_LABEL,
  ballBoardColumnOf,
  type BallBoardColumn,
} from '@trakon/shared';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/components/ui/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { planCardStyle } from '@/features/plans/planTheme';
import { dashboardApi, dashboardQueryKey, type DashboardTask } from '@/features/dashboard/api';

/** ボードのカード 1 枚分。API の階層 (プロジェクト → メンバー → 予定) を平らにしたもの。 */
export type BoardBall = DashboardTask & {
  projectName: string;
  holderName: string;
  holderIsMe: boolean;
};

/**
 * 列ごとのアクセント色 (Figma node 61:2〜61:5)。
 * スケジュールカードと同じ 10 テーマから選び、パレットを増やさない。
 */
const COLUMN_THEME: Record<BallBoardColumn, { surface: string; text: string }> = {
  in_progress: { surface: 'bg-plan-blue-surface', text: 'text-plan-blue-accent' },
  awaiting_reply: { surface: 'bg-plan-violet-surface', text: 'text-plan-violet-accent' },
  return_handling: { surface: 'bg-plan-coral-surface', text: 'text-plan-coral-accent' },
  awaiting_toss: { surface: 'bg-plan-rose-surface', text: 'text-plan-rose-accent' },
};

/**
 * SC-09 ダッシュボード (Figma node 57:2)。
 * 参加中の全プロジェクトのボールを「次に必要な行動」で 4 列に並べる。
 */
export function DashboardPage() {
  const [projectFilter, setProjectFilter] = useState('all');
  const [onlyMine, setOnlyMine] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: dashboardQueryKey.base(),
    queryFn: () => dashboardApi.get(),
  });

  const projects = useMemo(
    () => (data?.projects ?? []).map((p) => ({ id: p.id, name: p.name })),
    [data],
  );

  const balls = useMemo<BoardBall[]>(() => {
    if (!data) return [];
    return data.projects.flatMap((project) =>
      project.memberSections.flatMap((section) =>
        section.tasks.map((task) => ({
          ...task,
          projectName: project.name,
          holderName: section.member.name,
          holderIsMe: section.member.isMe,
        })),
      ),
    );
  }, [data]);

  const visible = useMemo(
    () =>
      balls.filter(
        (b) =>
          (projectFilter === 'all' || b.projectId === projectFilter) &&
          (!onlyMine || b.holderIsMe),
      ),
    [balls, projectFilter, onlyMine],
  );

  const byColumn = useMemo(() => {
    const map = new Map<BallBoardColumn, BoardBall[]>(
      BALL_BOARD_COLUMNS.map((c) => [c, [] as BoardBall[]]),
    );
    for (const b of visible) {
      const col = ballBoardColumnOf(b.ballState);
      if (col) map.get(col)!.push(b);
    }
    // 期限が近い順。期限なしは末尾。
    for (const list of map.values()) {
      list.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    }
    return map;
  }, [visible]);

  const today = data?.today ? parseISO(data.today) : new Date();

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        width="full"
        title="ダッシュボード"
        description={`${format(today, 'yyyy.M.d（E）', { locale: ja })} 時点のボール`}
        actions={
          <>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-49">
                <SelectValue placeholder="すべてのプロジェクト" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべてのプロジェクト</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="border-input flex h-10 cursor-pointer items-center gap-2.5 rounded-md border px-3.5 text-body">
              <input
                type="checkbox"
                checked={onlyMine}
                onChange={(e) => setOnlyMine(e.target.checked)}
                className="accent-primary size-4"
              />
              要対応のみ
            </label>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-7">
        {error ? (
          <p className="text-text-secondary py-12 text-center text-body">
            ダッシュボードの取得に失敗しました。
          </p>
        ) : isLoading ? (
          <BoardSkeleton />
        ) : (
          <BallBoard byColumn={byColumn} />
        )}
      </div>
    </div>
  );
}

/** 4 列のボード本体 (Figma node 57:2)。データ取得を持たないので Storybook で確認できる。 */
export function BallBoard({ byColumn }: { byColumn: Map<BallBoardColumn, BoardBall[]> }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {BALL_BOARD_COLUMNS.map((col) => (
        <BoardColumn key={col} column={col} balls={byColumn.get(col) ?? []} />
      ))}
    </div>
  );
}

function BoardColumn({ column, balls }: { column: BallBoardColumn; balls: BoardBall[] }) {
  const theme = COLUMN_THEME[column];
  return (
    <section className="border-border bg-surface-subtle flex min-h-0 flex-col overflow-hidden rounded-2xl border">
      <header
        className={cn(
          'border-border flex h-14 shrink-0 items-center gap-2 border-b px-4',
          theme.surface,
        )}
      >
        <h2 className={cn('flex-1 truncate text-[15px] font-bold', theme.text)}>
          {BALL_BOARD_COLUMN_LABEL[column]}
        </h2>
        <span
          className={cn(
            'flex h-7 min-w-8 shrink-0 items-center justify-center rounded-full bg-background px-2 text-xs font-medium',
            theme.text,
          )}
        >
          {balls.length}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {balls.length === 0 ? (
          <p className="text-text-tertiary py-6 text-center text-xs">対象のボールはありません</p>
        ) : (
          balls.map((b) => <BallCard key={b.planId} ball={b} />)
        )}
      </div>
    </section>
  );
}

/** ボードのカード (Figma node 57:497)。クリックでその予定の詳細ドロワーを開く。 */
function BallCard({ ball }: { ball: BoardBall }) {
  const theme = planCardStyle(ball.category);
  return (
    <Link
      to={`/projects/${ball.projectId}/items/${ball.itemId}?modal=ball-detail&planId=${ball.planId}`}
      className={cn(
        'text-plan-foreground flex flex-col gap-2 rounded-xl border p-3.5 transition-shadow hover:shadow-card',
        theme.surface,
        ball.isOverdue ? 'border-danger border-2' : 'border-border',
      )}
    >
      <span className="text-text-secondary truncate text-mini font-medium">
        {ball.projectName}｜{ball.itemName}
      </span>
      <span className="truncate text-base font-bold">{ball.title}</span>

      <span className="text-text-secondary mt-1 text-mini">現在の保持者</span>
      <span className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-tiny font-bold"
        >
          {ball.holderName.trim().charAt(0)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-bold">{ball.holderName}</span>
          {ball.progressManager && (
            <span className="text-text-secondary truncate text-mini">
              進行責任者 {ball.progressManager.name}
            </span>
          )}
        </span>
      </span>

      <span className="mt-1 flex items-center justify-between gap-2">
        <span className="text-text-secondary text-tiny font-medium">
          {ball.dueDate
            ? `期限 ${format(parseISO(ball.dueDate), 'M.d（E）', { locale: ja })}`
            : '期限なし'}
        </span>
        {ball.isOverdue ? (
          <Badge variant="danger" shape="pill">
            期限超過
          </Badge>
        ) : (
          <Badge variant="success" shape="pill">
            順調
          </Badge>
        )}
      </span>
    </Link>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {BALL_BOARD_COLUMNS.map((c) => (
        <div key={c} className="border-border flex flex-col gap-3 rounded-2xl border p-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}
