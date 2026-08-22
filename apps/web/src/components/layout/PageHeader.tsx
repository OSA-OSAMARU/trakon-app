import { cn } from '@/components/ui/utils';

const WIDTHS = {
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
  full: 'max-w-none',
} as const;

/**
 * 全ページ共通のページヘッダ (Figma node 9:31)。
 *
 * 白い帯として描画し、本文のグレー領域 (--content) に対してコントラストを付ける。
 * 上段はパンくず / タイトル / 補足 と右のアクション、下段は任意のツールバー行
 * (スケジュール画面の月ピッカー・「今日」・メンバーなど) の 2 段構成。
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  toolbar,
  width = 'lg',
  sticky = true,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  /** タイトル行の下に敷く操作行。指定したときだけ描画する */
  toolbar?: React.ReactNode;
  width?: keyof typeof WIDTHS;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <header className={cn('border-border bg-card border-b', sticky && 'sticky top-0 z-20', className)}>
      <div
        className={cn(
          'mx-auto flex w-full flex-wrap items-start justify-between gap-4 px-7 pt-5 pb-4',
          WIDTHS[width],
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          {breadcrumb && (
            <div className="text-text-tertiary flex items-center gap-2 text-tiny">{breadcrumb}</div>
          )}
          <h1 className="text-title font-bold">{title}</h1>
          {description && <p className="text-text-secondary text-body">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {toolbar && (
        <div
          className={cn(
            'mx-auto flex w-full flex-wrap items-center gap-3 px-7 pb-3',
            WIDTHS[width],
          )}
        >
          {toolbar}
        </div>
      )}
    </header>
  );
}
