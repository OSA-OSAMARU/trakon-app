import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/components/ui/utils';
import { ApiClientError } from '@/lib/api';
import { CATEGORY_STYLE } from '@/features/plans/categoryColor';
import type { Plan } from '@/features/plans/api';
import { shareAccessApi, type ShareView } from './api';

/**
 * 非会員 URL 操作画面 (`/share/:token`)
 *  - 未認証可
 *  - クローラ防止 meta タグを document に注入
 *  - share scope 範囲のプラン一覧 + クライアントロール相当の TOSS/完了
 */
export function SharePage() {
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(meta);
    const original = document.title;
    document.title = 'TRAKON — 共有リンク';
    return () => {
      meta.remove();
      document.title = original;
    };
  }, []);

  if (!token) return <CenteredError text="無効なリンクです。" />;

  return <Inner token={token} />;
}

function Inner({ token }: { token: string }) {
  const qc = useQueryClient();
  const queryKey = ['share', token] as const;

  const viewQuery = useQuery({
    queryKey,
    queryFn: () => shareAccessApi.view(token),
    retry: 0,
  });

  const tossMut = useMutation({
    mutationFn: (planId: string) => shareAccessApi.toss(token, planId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success('TOSS しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : 'TOSS に失敗しました'),
  });

  const completeMut = useMutation({
    mutationFn: (planId: string) => shareAccessApi.complete(token, planId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey });
      toast.success('完了しました');
      if (res.autoTossed) toast.message('後続の予定に自動 TOSS しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '完了に失敗しました'),
  });

  if (viewQuery.isLoading) return <PageSkeleton />;
  if (viewQuery.error) {
    return (
      <CenteredError text="リンクが見つからないか、期限切れです。発行者にお問い合わせください。" />
    );
  }
  const data = viewQuery.data!;
  return (
    <Layout view={data}>
      <PlansList
        plans={data.plans}
        items={data.items}
        onToss={(planId) => tossMut.mutate(planId)}
        onComplete={(planId) => completeMut.mutate(planId)}
        busy={tossMut.isPending || completeMut.isPending}
      />
    </Layout>
  );
}

function Layout({ view, children }: { view: ShareView; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-10">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="size-3" />
            共有リンク (非会員)
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{view.project.name}</h1>
          <p className="text-xs text-muted-foreground">
            {view.share.expiresAt
              ? `有効期限 ${format(new Date(view.share.expiresAt), 'yyyy/M/d HH:mm')} まで`
              : '有効期限なし (無期限)'}
          </p>
        </div>
        <Badge variant="secondary">
          scope: {view.share.scopeType}
        </Badge>
      </header>
      {children}
    </div>
  );
}

function PlansList({
  plans,
  items,
  onToss,
  onComplete,
  busy,
}: {
  plans: Plan[];
  items: ShareView['items'];
  onToss: (planId: string) => void;
  onComplete: (planId: string) => void;
  busy: boolean;
}) {
  if (plans.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          表示できる予定はありません。
        </CardContent>
      </Card>
    );
  }

  // item ごとにグルーピング
  const itemMap = new Map(items.map((it) => [it.id, it.name] as const));
  const byItem = new Map<string, Plan[]>();
  for (const p of plans) {
    const arr = byItem.get(p.itemId) ?? [];
    arr.push(p);
    byItem.set(p.itemId, arr);
  }

  return (
    <div className="space-y-4">
      {Array.from(byItem.entries()).map(([itemId, list]) => (
        <Card key={itemId}>
          <CardHeader>
            <CardTitle className="text-sm">{itemMap.get(itemId) ?? '制作物'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {list.map((p) => (
              <PlanRow
                key={p.id}
                plan={p}
                onToss={() => onToss(p.id)}
                onComplete={() => onComplete(p.id)}
                busy={busy}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PlanRow({
  plan,
  onToss,
  onComplete,
  busy,
}: {
  plan: Plan;
  onToss: () => void;
  onComplete: () => void;
  busy: boolean;
}) {
  const style = CATEGORY_STYLE[plan.category];
  const completed = plan.status === 'completed';
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2 text-sm',
        completed
          ? 'border-slate-200 bg-slate-50 text-slate-500'
          : `${style.bg} ${style.border} ${style.text}`,
      )}
    >
      <Badge variant="secondary" className="px-1 py-0 text-[10px]">
        {style.label}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className={cn('line-clamp-1 font-medium', completed && 'line-through')}>
          {plan.title}
        </p>
        <p className="text-[11px] opacity-80">
          {format(new Date(plan.scheduledDate), 'M/d')}
          {plan.dueDate && ` 〜 期日 ${format(new Date(plan.dueDate), 'M/d')}`}
          {plan.ballHolder && ` ・ ホルダー: ${plan.ballHolder.name}`}
        </p>
      </div>
      {completed ? (
        <Badge variant="secondary">完了済み</Badge>
      ) : (
        <div className="flex gap-1">
          {plan.ballState === 'ready' && (
            <Button size="sm" variant="outline" onClick={onToss} disabled={busy}>
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
              TOSS
            </Button>
          )}
          {plan.ballState === 'tossed' && (
            <Button size="sm" onClick={onComplete} disabled={busy}>
              {busy ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
              完了
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-3 px-6 py-10">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

function CenteredError({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      <AlertCircle className="size-6 text-destructive" />
      <p>{text}</p>
    </div>
  );
}
