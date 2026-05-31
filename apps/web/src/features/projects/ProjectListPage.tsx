import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ArrowRight, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { projectsApi, projectsQueryKey } from './api';

const dateFmt = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' });

export function ProjectListPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: projectsQueryKey.all,
    queryFn: projectsApi.list,
  });

  return (
    <PageContainer width="lg">
      <PageHeader
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

      {isLoading && <ListSkeleton />}

      {error && (
        <Card>
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-destructive">
            <AlertCircle className="size-4" />
            プロジェクト一覧の取得に失敗しました。
          </CardContent>
        </Card>
      )}

      {data && data.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              まだプロジェクトがありません。
            </p>
            <Button asChild size="sm">
              <Link to="/projects/new">最初のプロジェクトを作成</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <li key={p.id}>
              <Card className="hover:border-foreground/30 transition-colors">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>
                      {p.status === 'active' ? '進行中' : '終了'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="text-muted-foreground">
                    {dateFmt.format(new Date(p.startDate))} —{' '}
                    {dateFmt.format(new Date(p.endDate))}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{p.role === 'director' ? 'ディレクター' : 'メンバー'}</span>
                    <span>更新 {dateFmt.format(new Date(p.updatedAt))}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/projects/${p.id}/edit`}>編集</Link>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/projects/${p.id}`}>
                        詳細
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
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
