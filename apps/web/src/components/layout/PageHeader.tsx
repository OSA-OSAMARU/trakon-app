import { cn } from '@/components/ui/utils';

const WIDTHS = {
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
  full: 'max-w-none',
} as const;

/**
 * 全ページ共通のページヘッダ。プロトタイプ準拠で「白いヘッダ帯」として描画する
 * (本文のグレー領域に対しコントラストを付ける)。内側は PageContainer と同じ
 * 最大幅で中央寄せし、タイトル/説明/パンくず/アクションをページごとに出し分ける。
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  width = 'lg',
  sticky = true,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  width?: keyof typeof WIDTHS;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'border-b border-border bg-card',
        sticky && 'sticky top-0 z-20',
        className,
      )}
    >
      <div
        className={cn(
          'mx-auto flex w-full flex-wrap items-start justify-between gap-3 px-6 py-4',
          WIDTHS[width],
        )}
      >
        <div className="space-y-1">
          {breadcrumb && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {breadcrumb}
            </div>
          )}
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
