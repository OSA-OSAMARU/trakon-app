import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertCircle, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Plan } from '@/features/plans/api';
import { ShareSchedule } from './ShareSchedule';
import { ShareActionModal } from './ShareActionModal';
import { shareAccessApi, type ShareView } from './api';

/**
 * 非会員 URL 閲覧画面 (`/share/:token`)
 *  - 未認証可
 *  - クローラ防止 meta タグを document に注入
 *  - share scope 範囲のスケジュールを「閲覧専用カレンダー」で表示 (#59)
 *    (ドラッグ移動・TOSS・完了・作成などの操作は一切不可)
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
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const viewQuery = useQuery({
    queryKey: ['share', token] as const,
    queryFn: () => shareAccessApi.view(token),
    retry: 0,
  });

  if (viewQuery.isLoading) return <PageSkeleton />;
  if (viewQuery.error) {
    return (
      <CenteredError text="リンクが見つからないか、期限切れです。発行者にお問い合わせください。" />
    );
  }
  const data = viewQuery.data!;
  // 最新データ (invalidate 後の再取得) から選択中の予定を解決する。
  const selectedPlan = selectedPlanId
    ? (data.plans.find((p) => p.id === selectedPlanId) ?? null)
    : null;
  return (
    <div className="flex h-screen flex-col">
      <Header view={data} />
      <ShareSchedule
        project={data.project}
        items={data.items}
        plans={data.plans}
        onSelectPlan={(plan: Plan) => setSelectedPlanId(plan.id)}
      />
      {selectedPlan && (
        <ShareActionModal
          token={token}
          plan={selectedPlan}
          onClose={() => setSelectedPlanId(null)}
        />
      )}
    </div>
  );
}

function Header({ view }: { view: ShareView }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border bg-background px-6 py-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3" />
          共有リンク (確認・承認)
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{view.project.name}</h1>
        <p className="text-xs text-muted-foreground">
          期間: {format(new Date(view.project.startDate), 'yyyy/M/d')} 〜{' '}
          {format(new Date(view.project.endDate), 'yyyy/M/d')}
          {' ・ '}
          {view.share.expiresAt
            ? `有効期限 ${format(new Date(view.share.expiresAt), 'yyyy/M/d HH:mm')} まで`
            : '有効期限なし (無期限)'}
        </p>
      </div>
      <Badge variant="secondary">scope: {view.share.scopeType}</Badge>
    </header>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-3 p-8">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-[60vh] w-full rounded-md" />
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
