import { canProjectRole } from '@trakon/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Pencil, Plus, Trash2, Users, ArrowLeft, AlertCircle, CalendarDays, Link2, Archive, ArchiveRestore, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateField } from '@/components/ui/date-field';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
import { ApiClientError } from '@/lib/api';
import { cn } from '@/components/ui/utils';
import { moveItem, useDragReorder } from '@/lib/reorder';
import { projectsApi, projectsQueryKey, type ProjectItem } from './api';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で入力してください');

const basicSchema = z
  .object({
    name: z.string().trim().min(1, '名前は必須').max(255),
    startDate: isoDate,
    endDate: isoDate,
    status: z.enum(['active', 'closed']),
  })
  .refine((v) => v.endDate >= v.startDate, {
    path: ['endDate'],
    message: '終了日は開始日以降にしてください',
  });
type BasicValues = z.infer<typeof basicSchema>;

export function ProjectEditPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  if (!projectId) {
    return <NotFound />;
  }

  return <ProjectEditInner projectId={projectId} onBack={() => navigate('/projects')} />;
}

function ProjectEditInner({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const qc = useQueryClient();

  const projectQuery = useQuery({
    queryKey: projectsQueryKey.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });
  const itemsQuery = useQuery({
    queryKey: projectsQueryKey.items(projectId),
    queryFn: () => projectsApi.listItems(projectId),
  });

  const form = useForm<BasicValues>({ resolver: zodResolver(basicSchema) });
  useEffect(() => {
    if (projectQuery.data) {
      form.reset({
        name: projectQuery.data.name,
        startDate: projectQuery.data.startDate,
        endDate: projectQuery.data.endDate,
        status: projectQuery.data.status,
      });
    }
  }, [projectQuery.data, form]);

  const updateMut = useMutation({
    mutationFn: (v: BasicValues) => projectsApi.update(projectId, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsQueryKey.detail(projectId) });
      qc.invalidateQueries({ queryKey: projectsQueryKey.all });
      toast.success('プロジェクトを更新しました');
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError ? err.message : '更新に失敗しました'),
  });

  if (projectQuery.isLoading) return <PageSkeleton />;
  if (projectQuery.error) return <NotFound />;
  const project = projectQuery.data!;

  return (
    <>
      <PageHeader
        width="md"
        title={project.name}
        description="プロジェクト設定"
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/projects/${projectId}`}>
                <CalendarDays className="size-4" />
                スケジュール
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="size-4" />
              プロジェクト一覧に戻る
            </Button>
          </div>
        }
      />
      <PageContainer width="md">
      <form onSubmit={form.handleSubmit((v) => updateMut.mutate(v))}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">基本情報</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="プロジェクト名" error={form.formState.errors.name?.message}>
              <Input {...form.register('name')} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="開始日" error={form.formState.errors.startDate?.message}>
                <DateField {...form.register('startDate')} />
              </Field>
              <Field label="終了日" error={form.formState.errors.endDate?.message}>
                <DateField {...form.register('endDate')} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={updateMut.isPending || !form.formState.isDirty}>
                {updateMut.isPending && <Loader2 className="size-4 animate-spin" />}
                保存
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <ItemsSection projectId={projectId} items={itemsQuery.data ?? []} loading={itemsQuery.isLoading} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">参加者管理</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            参加者の追加・招待・削除を行います。
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/projects/${projectId}/members?tab=manage`}>
              <Users className="size-4" />
              参加者管理を開く
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">共有リンク</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            非会員クライアント向けに閲覧・操作用 URL を発行します。
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/projects/${projectId}/share-links`}>
              <Link2 className="size-4" />
              共有リンクを管理
            </Link>
          </Button>
        </CardContent>
      </Card>

      {canProjectRole(project.role, 'project.archive') && (
        <ArchiveCard
          projectId={projectId}
          name={project.name}
          archived={project.archivedAt !== null}
          onUnarchived={onBack}
        />
      )}
      </PageContainer>
    </>
  );
}

// -----------------------------------------------------------------------------
// アーカイブセクション (director のみ)
// -----------------------------------------------------------------------------
function ArchiveCard({
  projectId,
  name,
  archived,
  onUnarchived,
}: {
  projectId: string;
  name: string;
  archived: boolean;
  onUnarchived: () => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      archived ? projectsApi.unarchive(projectId) : projectsApi.archive(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsQueryKey.detail(projectId) });
      qc.invalidateQueries({ queryKey: projectsQueryKey.all });
      qc.invalidateQueries({ queryKey: projectsQueryKey.archived });
      toast.success(archived ? 'プロジェクトを復元しました' : 'プロジェクトをアーカイブしました');
      setConfirming(false);
      // アーカイブした直後は一覧に残らないため一覧へ戻す
      if (!archived) onUnarchived();
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '操作に失敗しました'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">アーカイブ</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {archived
            ? 'このプロジェクトはアーカイブ済みです。復元すると一覧・サイドバーに再表示されます。'
            : 'アーカイブするとプロジェクト一覧とサイドバーから非表示になります。'}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={mutation.isPending}
        >
          {archived ? (
            <>
              <ArchiveRestore className="size-4" />
              復元する
            </>
          ) : (
            <>
              <Archive className="size-4" />
              アーカイブする
            </>
          )}
        </Button>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archived ? `「${name}」を復元しますか？` : `「${name}」をアーカイブしますか？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? 'アーカイブを解除し、進行中の一覧に戻します。'
                : 'プロジェクト一覧とサイドバーから非表示になります。アーカイブ済みタブから復元できます。'}
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
              {archived ? '復元する' : 'アーカイブする'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// 制作物セクション
// -----------------------------------------------------------------------------
function ItemsSection({
  projectId,
  items,
  loading,
}: {
  projectId: string;
  items: ProjectItem[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ id: string | 'new'; name: string } | null>(null);
  const [deleting, setDeleting] = useState<ProjectItem | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: projectsQueryKey.items(projectId) });

  const createMut = useMutation({
    mutationFn: (name: string) => projectsApi.createItem(projectId, { name }),
    onSuccess: () => {
      invalidate();
      toast.success('制作物を追加しました');
      setEditing(null);
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '追加に失敗しました'),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      projectsApi.updateItem(projectId, id, { name }),
    onSuccess: () => {
      invalidate();
      toast.success('制作物を更新しました');
      setEditing(null);
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '更新に失敗しました'),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => projectsApi.deleteItem(projectId, id),
    onSuccess: () => {
      invalidate();
      toast.success('制作物を削除しました');
      setDeleting(null);
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '削除に失敗しました'),
  });

  // 並び替え (#111)。楽観更新でリストを即時入れ替え、失敗時はロールバック。
  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) => projectsApi.reorderItems(projectId, orderedIds),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: projectsQueryKey.items(projectId) });
      const prev = qc.getQueryData<ProjectItem[]>(projectsQueryKey.items(projectId));
      if (prev) {
        const byId = new Map(prev.map((i) => [i.id, i]));
        const next = orderedIds.map((id) => byId.get(id)).filter((i): i is ProjectItem => !!i);
        qc.setQueryData(projectsQueryKey.items(projectId), next);
      }
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(projectsQueryKey.items(projectId), ctx.prev);
      toast.error(e instanceof ApiClientError ? e.message : '並び替えに失敗しました');
    },
    onSettled: () => invalidate(),
  });

  const drag = useDragReorder((from, to) => {
    reorderMut.mutate(moveItem(items, from, to).map((i) => i.id));
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">制作物</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing({ id: 'new', name: '' })}
          >
            <Plus className="size-4" />
            追加
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <Skeleton className="h-24 w-full rounded-md" />}
        {!loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">まだ制作物がありません。</p>
        )}
        <ul className="divide-y divide-border">
          {items.map((it, idx) => (
            <li
              key={it.id}
              {...drag.rowProps(idx)}
              className={cn(
                'flex items-center justify-between gap-2 py-2',
                drag.fromIndex === idx && 'opacity-50',
                drag.overIndex === idx && drag.fromIndex !== idx && 'border-t-2 border-t-primary',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  {...drag.handleProps(idx)}
                  className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                  aria-label="ドラッグして並び替え"
                  title="ドラッグして並び替え"
                >
                  <GripVertical className="size-4" />
                </span>
                <div className="truncate text-sm">{it.name}</div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/projects/${projectId}/items/${it.id}`}>
                    <CalendarDays className="size-4" />
                    スケジュール
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditing({ id: it.id, name: it.name })}
                  aria-label="編集"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleting(it)}
                  aria-label="削除"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>

      {editing && (
        <ItemEditDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={(name) => {
            if (editing.id === 'new') createMut.mutate(name);
            else updateMut.mutate({ id: editing.id, name });
          }}
          submitting={createMut.isPending || updateMut.isPending}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{deleting?.name}」を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              この操作は取り消せません。配下の予定も一緒に削除されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMut.mutate(deleting.id);
              }}
              disabled={deleteMut.isPending}
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ItemEditDialog({
  initial,
  onSubmit,
  onClose,
  submitting,
}: {
  initial: { id: string | 'new'; name: string };
  onSubmit: (name: string) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const dirty = name.trim() !== initial.name.trim() && name.trim() !== '';
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {initial.id === 'new' ? '制作物を追加' : '制作物を編集'}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="item-name">名称</Label>
          <Input
            id="item-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            autoFocus
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (dirty) onSubmit(name.trim());
            }}
            disabled={!dirty || submitting}
          >
            {initial.id === 'new' ? '追加' : '保存'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// -----------------------------------------------------------------------------
function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-8 py-10">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-8 py-20">
      <AlertCircle className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">プロジェクトが見つかりませんでした。</p>
      <Button asChild variant="outline" size="sm">
        <Link to="/projects">プロジェクト一覧に戻る</Link>
      </Button>
    </div>
  );
}
