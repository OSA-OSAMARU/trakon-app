import { cn } from '@/components/ui/utils';

const WIDTHS = {
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
  full: 'max-w-none',
} as const;

/**
 * 全ページ共通のページヘッダ (Figma「08 Header / Comparison」node 419:132)。
 *
 * 白い帯として描画し、本文のベージュ領域 (--content) に対してコントラストを付ける。
 * ガイドは 4 パターンを示すが、いずれも同じ器で表現できる。
 *   01 Standard         title + description
 *   02 With Action      + actions (右側に主要操作または絞り込み)
 *   03 With Breadcrumb  + breadcrumb
 *   04 With Sub toolbar + toolbar (スケジュール専用操作を本体から分離)
 *
 * 寸法は実測どおり本体帯 132px・左右余白 32px・Sub toolbar 帯 64px。
 * タイトル・説明・操作は同じ基準線 (垂直中央) に揃える。
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
          'mx-auto flex min-h-[132px] w-full flex-wrap items-center justify-between gap-4 px-8 py-5',
          WIDTHS[width],
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          {breadcrumb && (
            <div className="text-text-tertiary flex items-center gap-2 text-label">{breadcrumb}</div>
          )}
          <h1 className="text-heading-page font-bold">{title}</h1>
          {description && <p className="text-text-secondary text-body">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {toolbar && (
        <div
          className={cn(
            'border-border mx-auto flex h-16 w-full flex-wrap items-center gap-3 border-t px-8',
            WIDTHS[width],
          )}
        >
          {toolbar}
        </div>
      )}
    </header>
  );
}
