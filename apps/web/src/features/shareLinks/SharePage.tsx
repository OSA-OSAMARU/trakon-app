import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Plan } from '@/features/plans/api';
import { ShareSchedule } from './ShareSchedule';
import { SharePlanDetailSheet } from './SharePlanDetailSheet';
import { shareAccessApi, type ShareView } from './api';

const SCOPE_LABEL: Record<ShareView['share']['scopeType'], string> = {
  project: 'プロジェクト全体',
  item: '特定の制作物',
  plan: '特定の予定',
};

/**
 * 非会員 URL 閲覧画面 (`/share/:token`) — Figma node 495:306
 *  - 未認証可
 *  - クローラ防止 meta タグを document に注入
 *  - share scope 範囲のスケジュールを「閲覧専用カレンダー」で表示 (#59 / #257)
 *    (ドラッグ移動・作成はもちろん、承認・差し戻しなどデータを変える操作も一切不可。
 *     ボールをクリックすると閲覧専用の詳細パネルが開くだけ)
 *
 * レイアウト (#256): 会員側の画面はサイドバーが左の余白を作っているが、共有画面には
 * サイドバーが無く、カレンダーが画面の端に貼り付いていた。Figma と同じく
 * **淡色の地の上に角丸のカードを浮かせ、周囲に余白を取る**構成にする。
 * 印刷でもこのカードがそのまま 1 枚に収まる想定 (Figma の "Browser print compatible")。
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
  // 最新データ (再取得後) から選択中の予定を解決する。
  const selectedPlan = selectedPlanId
    ? (data.plans.find((p) => p.id === selectedPlanId) ?? null)
    : null;

  return (
    <ShareCanvas>
      <Header view={data} />
      {/* カレンダーもカードの内側に寄せる (Figma node 496:317 は左に 32px の余白を持つ) */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-8 sm:pb-6">
        <ShareSchedule
          project={data.project}
          items={data.items}
          plans={data.plans}
          onSelectPlan={(plan: Plan) => setSelectedPlanId(plan.id)}
        />
      </div>
      {selectedPlan && (
        <SharePlanDetailSheet plan={selectedPlan} onClose={() => setSelectedPlanId(null)} />
      )}
    </ShareCanvas>
  );
}

/**
 * 淡色の地 + 角丸カード (Figma node 496:309)。
 *
 * 余白は画面幅で変える。Figma の実測は 1440px 幅で左右 48px だが、狭い画面で
 * 同じだけ取るとカレンダーの列が潰れるので、モバイルでは詰める。
 */
function ShareCanvas({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-muted flex h-screen flex-col p-3 sm:p-4 lg:px-12 lg:py-4">
      <div className="border-border bg-background shadow-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border">
        {children}
      </div>
    </div>
  );
}

/**
 * カード上部の見出し (Figma node 496:311〜496:315)。
 * 左にプロジェクト名と期間、右上に「共有用」バッジ、右下に有効期限を置く。
 */
function Header({ view }: { view: ShareView }) {
  const expires = view.share.expiresAt;
  const expiryText = expires
    ? `有効期限 ${format(new Date(expires), 'yyyy/MM/dd HH:mm')}まで`
    : '有効期限なし（無期限）';
  return (
    // 狭い画面ではプロジェクト名を削るより縦に積む (名前が「歌文協…」に潰れると
    // 何の共有リンクなのか分からなくなる)
    <header className="flex flex-col gap-3 px-4 pt-5 pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-8 sm:pt-7 sm:pb-4">
      <div className="min-w-0">
        <h1 className="text-heading-page font-bold tracking-tight">{view.project.name}</h1>
        <p className="text-text-secondary mt-1 text-label">
          期間：{format(new Date(view.project.startDate), 'yyyy/MM/dd')} 〜{' '}
          {format(new Date(view.project.endDate), 'yyyy/MM/dd')}
          {view.share.scopeType !== 'project' && ` ・ ${SCOPE_LABEL[view.share.scopeType]}の共有`}
        </p>
      </div>
      {/* バッジで「共有リンクで見ている」ことを、隣で「いつまで見られるか」を伝える。
          広い画面では Figma (node 496:313 / 496:315) と同じ上下 2 段にする */}
      <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
        <Badge variant="brand" shape="pill">
          共有用
        </Badge>
        <p className="text-text-tertiary text-label">{expiryText}</p>
      </div>
    </header>
  );
}

function PageSkeleton() {
  return (
    <ShareCanvas>
      <div className="space-y-3 px-4 pt-5 pb-3 sm:px-8 sm:pt-7 sm:pb-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-1/4" />
      </div>
      <Skeleton className="mx-4 mb-4 min-h-0 flex-1 rounded-lg sm:mx-8 sm:mb-6" />
    </ShareCanvas>
  );
}

function CenteredError({ text }: { text: string }) {
  return (
    <div className="bg-surface-muted text-text-secondary flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center text-body">
      <AlertCircle className="text-danger size-6" />
      <p>{text}</p>
    </div>
  );
}
