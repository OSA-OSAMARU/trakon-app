import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Pencil, Plus, Trash2, Users, ArrowLeft, AlertCircle, CalendarDays, Link2 } from 'lucide-react';
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
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
            一覧に戻る
          </Button>
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
      </PageContainer>
    </>
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
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 py-2">
              <div className="text-sm">{it.name}</div>
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
              削除する
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
        <Link to="/projects">一覧に戻る</Link>
      </Button>
    </div>
  );
}
