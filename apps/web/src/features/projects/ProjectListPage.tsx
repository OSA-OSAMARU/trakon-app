import { canProjectRole } from '@trakon/shared';
import { useEntitlement } from '@/features/billing/useEntitlement';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Smile,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/components/ui/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { ApiClientError } from '@/lib/api';
import { projectsApi, projectsQueryKey, type ProjectSummary } from './api';

const SORTS = [
  { value: 'updated', label: '更新日の新しい順' },
  { value: 'start', label: '開始日の早い順' },
  { value: 'name', label: '名前順' },
  { value: 'overdue', label: '遅延の多い順' },
] as const;

type Sort = (typeof SORTS)[number]['value'];

/** SC-03 プロジェクト一覧 (Figma node 84:2)。 */
export function ProjectListPage() {
  // タブを URL に載せる。サイドバーの「アーカイブ済み」導線から直接開けるようにするため。
  const [searchParams, setSearchParams] = useSearchParams();
  const archived = searchParams.get('tab') === 'archived';
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<Sort>('updated');

  // プランの上限。到達していれば作成ボタンを無効化し、理由と復旧導線を出す (§4.5.2)
  const { entitlement, frozenProjectIds } = useEntitlement();
  const canCreateProject = entitlement?.canCreateProject ?? true;
  const limitReached = entitlement !== null && !entitlement.canCreateProject;

  const { data, isLoading, error } = useQuery({
    queryKey: archived ? projectsQueryKey.archived : projectsQueryKey.all,
    queryFn: () => projectsApi.list({ archived }),
  });

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const filtered = (data ?? []).filter(
      (p) =>
        kw === '' ||
        p.name.toLowerCase().includes(kw) ||
        (p.clientName ?? '').toLowerCase().includes(kw),
    );
    const sorted = filtered.slice();
    sorted.sort((a, b) => {
      switch (sort) {
        case 'start':
          return a.startDate.localeCompare(b.startDate);
        case 'name':
          return a.name.localeCompare(b.name, 'ja');
        case 'overdue':
          return b.overdueCount - a.overdueCount;
        default:
          return b.updatedAt.localeCompare(a.updatedAt);
      }
    });
    return sorted;
  }, [data, keyword, sort]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        width="full"
        breadcrumb={<span>PROJECTS</span>}
        title="プロジェクト一覧"
        description="進行中のプロジェクトと遅延状況を確認します"
        actions={
          canCreateProject ? (
            <Button size="lg" asChild>
              <Link to="/projects/new">
                <Plus />
                プロジェクトを作成
              </Link>
            </Button>
          ) : (
            // 課金起因の制限は隠さず無効化して理由を出す (§4.5.2)
            <Button size="lg" disabled>
              <Plus />
              プロジェクトを作成
            </Button>
          )
        }
      />

      <div className="min-h-0 flex-1 overflow-auto px-12 py-8">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6">
          {limitReached && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-warning-subtle px-4 py-3 text-sm">
              <span>{entitlement?.message}</span>
              <span className="flex gap-3">
                <Link to="/settings/billing" className="font-medium underline underline-offset-2">
                  プランを見る
                </Link>
                <span className="text-text-tertiary">
                  アーカイブすると枠が空きます
                </span>
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-6">
            <div className="relative w-90">
              <Search
                className="text-text-tertiary absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="プロジェクト名・クライアント名で検索"
                aria-label="プロジェクトを検索"
                className="bg-content pl-10"
              />
            </div>
            <span className="text-text-secondary text-body">
              {archived ? 'アーカイブ済み' : '進行中'} {rows.length}件
            </span>
            <span className="flex-1" />
            <Button
              variant="ghost"
              onClick={() =>
                setSearchParams(archived ? {} : { tab: 'archived' }, { replace: true })
              }
            >
              {archived ? '進行中を見る' : 'アーカイブ済みを見る'}
            </Button>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger className="w-49">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <TableSkeleton />
          ) : error ? (
            <p className="text-destructive flex items-center justify-center gap-2 py-12 text-body">
              <AlertCircle className="size-4" />
              プロジェクト一覧の取得に失敗しました。
            </p>
          ) : rows.length === 0 ? (
            <EmptyState archived={archived} filtered={keyword.trim() !== ''} />
          ) : (
            <ProjectTable rows={rows} frozenProjectIds={frozenProjectIds} />
          )}
        </div>
      </div>
    </div>
  );
}

/** テーブル本体 (Figma node 84:78)。行全体がスケジュールへのリンクになる。 */
export function ProjectTable({
  rows,
  frozenProjectIds = [],
}: {
  rows: ProjectSummary[];
  /** プラン上限超過で閲覧のみになっているプロジェクト (§7.11) */
  frozenProjectIds?: string[];
}) {
  return (
    <div className="border-border overflow-hidden rounded-2xl border bg-background">
      <div className="border-border bg-surface-subtle text-text-secondary grid h-13 grid-cols-[72px_1fr_200px_180px_56px] items-center border-b text-xs font-medium">
        <span />
        <span>プロジェクト</span>
        <span>期間</span>
        <span>進行責任者</span>
        <span />
      </div>
      <ul>
        {rows.map((p) => (
          <li key={p.id}>
            <ProjectRow project={p} frozen={frozenProjectIds.includes(p.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectRow({
  project: p,
  frozen,
}: {
  project: ProjectSummary;
  /** プラン上限超過で閲覧のみになっているか (削除はされていない、§7.11) */
  frozen?: boolean;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const isArchived = p.archivedAt !== null;
  // 権限判定は shared のロール別操作マトリクスに委ねる (§4.5)
  const canManage = canProjectRole(p.role, 'project.archive');

  const mutation = useMutation({
    mutationFn: () => (isArchived ? projectsApi.unarchive(p.id) : projectsApi.archive(p.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsQueryKey.all });
      qc.invalidateQueries({ queryKey: projectsQueryKey.archived });
      qc.invalidateQueries({ queryKey: projectsQueryKey.detail(p.id) });
      toast.success(isArchived ? 'プロジェクトを復元しました' : 'プロジェクトをアーカイブしました');
      setConfirming(false);
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : '操作に失敗しました'),
  });

  return (
    <div className="border-border hover:bg-accent group/row relative grid h-[86px] grid-cols-[72px_1fr_200px_180px_56px] items-center border-b transition-colors last:border-b-0">
      <Link
        to={`/projects/${p.id}`}
        className="absolute inset-0"
        aria-label={`${p.name} のスケジュールを開く`}
      />
      <span className="flex justify-center">
        <DelayStatusIcon overdueCount={p.overdueCount} />
      </span>
      <span className="flex min-w-0 flex-col gap-1 pr-4">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-bold">{p.name}</span>
          {frozen && (
            <Badge variant="secondary" size="sm" className="shrink-0">
              閲覧のみ
            </Badge>
          )}
        </span>
        <span className="text-text-secondary truncate text-xs">{p.clientName ?? '—'}</span>
      </span>
      <span className="text-text-secondary text-body">
        {format(parseISO(p.startDate), 'yyyy.M.d')} – {format(parseISO(p.endDate), 'M.d')}
      </span>
      <span className="text-text-secondary truncate pr-4 text-body">
        {p.progressManager?.name ?? '—'}
      </span>
      <span className="relative flex items-center justify-center gap-1">
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${p.name} の操作`}
                className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/projects/${p.id}/edit`}>
                  <Pencil />
                  プロジェクト情報
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConfirming(true)}>
                {isArchived ? <ArchiveRestore /> : <Archive />}
                {isArchived ? '復元' : 'アーカイブ'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <ChevronRight className="text-text-tertiary size-5 shrink-0" aria-hidden />
      </span>

      <AlertDialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isArchived ? `「${p.name}」を復元しますか？` : `「${p.name}」をアーカイブしますか？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isArchived
                ? 'アーカイブを解除し、進行中の一覧に戻します。'
                : 'プロジェクト一覧とサイドバーから非表示になります。アーカイブ済みから復元できます。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
              disabled={mutation.isPending}
            >
              {isArchived ? '復元する' : 'アーカイブする'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 遅延状況のアイコン (Figma node 89:2 / 89:6)。期限超過のボールがあれば警告を出す。 */
function DelayStatusIcon({ overdueCount }: { overdueCount: number }) {
  const delayed = overdueCount > 0;
  const label = delayed ? `期限超過 ${overdueCount}件` : '順調';
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'flex size-7 items-center justify-center rounded-full',
        delayed ? 'text-danger' : 'text-success',
      )}
    >
      {delayed ? <TriangleAlert className="size-5" /> : <Smile className="size-5" />}
    </span>
  );
}

function EmptyState({ archived, filtered }: { archived: boolean; filtered: boolean }) {
  return (
    <div className="border-border flex flex-col items-center gap-3 rounded-2xl border border-dashed py-16 text-center">
      <p className="text-text-secondary text-body">
        {filtered
          ? '条件に一致するプロジェクトはありません。'
          : archived
            ? 'アーカイブされたプロジェクトはありません。'
            : 'まだプロジェクトがありません。'}
      </p>
      {!archived && !filtered && (
        <Button asChild>
          <Link to="/projects/new">最初のプロジェクトを作成</Link>
        </Button>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="border-border overflow-hidden rounded-2xl border">
      <Skeleton className="h-13 w-full rounded-none" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="mt-px h-[86px] w-full rounded-none" />
      ))}
    </div>
  );
}
