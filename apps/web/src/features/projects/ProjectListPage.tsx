import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ArrowRight, AlertCircle, Pencil, Archive, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { ApiClientError } from '@/lib/api';
import { projectsApi, projectsQueryKey, type ProjectSummary } from './api';

const dateFmt = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' });

export function ProjectListPage() {
  return (
    <>
      <PageHeader
        width="lg"
        title="プロジェクト"
        description="参加中のプロジェクト一覧"
        actions={
          <Button asChild>
            <Link to="/projects/new">
              <Plus className="size-4" />
              新規作成
            </Link>
          </Button>
        }
      />
      <PageContainer width="lg">
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">進行中</TabsTrigger>
            <TabsTrigger value="archived">アーカイブ済み</TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="mt-4">
            <ProjectList archived={false} />
          </TabsContent>
          <TabsContent value="archived" className="mt-4">
            <ProjectList archived={true} />
          </TabsContent>
        </Tabs>
      </PageContainer>
    </>
  );
}

function ProjectList({ archived }: { archived: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: archived ? projectsQueryKey.archived : projectsQueryKey.all,
    queryFn: () => projectsApi.list({ archived }),
  });

  if (isLoading) return <ListSkeleton />;

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-destructive">
          <AlertCircle className="size-4" />
          プロジェクト一覧の取得に失敗しました。
        </CardContent>
      </Card>
    );
  }

  if (data && data.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {archived
              ? 'アーカイブされたプロジェクトはありません。'
              : 'まだプロジェクトがありません。'}
          </p>
          {!archived && (
            <Button asChild size="sm">
              <Link to="/projects/new">最初のプロジェクトを作成</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {(data ?? []).map((p) => (
        <li key={p.id}>
          <ProjectCard project={p} />
        </li>
      ))}
    </ul>
  );
}

function ProjectCard({ project: p }: { project: ProjectSummary }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const isArchived = p.archivedAt !== null;
  const isDirector = p.role === 'director';

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
    <Card className="hover:border-foreground/30 transition-colors">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{p.name}</CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            {isArchived ? (
              <Badge variant="outline">アーカイブ済み</Badge>
            ) : (
              <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>
                {p.status === 'active' ? '進行中' : '終了'}
              </Badge>
            )}
            {!isArchived && (
              <Button variant="ghost" size="icon" className="size-7" asChild>
                <Link to={`/projects/${p.id}/edit`} aria-label="編集">
                  <Pencil className="size-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="text-muted-foreground">
          {dateFmt.format(new Date(p.startDate))} — {dateFmt.format(new Date(p.endDate))}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{p.role === 'director' ? 'ディレクター' : 'メンバー'}</span>
          <span>
            {isArchived && p.archivedAt
              ? `アーカイブ ${dateFmt.format(new Date(p.archivedAt))}`
              : `更新 ${dateFmt.format(new Date(p.updatedAt))}`}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/projects/${p.id}`}>
              スケジュール
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
          {isDirector &&
            (isArchived ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(true)}
                disabled={mutation.isPending}
              >
                <ArchiveRestore className="size-3.5" />
                復元
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(true)}
                disabled={mutation.isPending}
              >
                <Archive className="size-3.5" />
                アーカイブ
              </Button>
            ))}
        </div>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isArchived
                ? `「${p.name}」を復元しますか？`
                : `「${p.name}」をアーカイブしますか？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isArchived
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
              {isArchived ? '復元する' : 'アーカイブする'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  );
}
