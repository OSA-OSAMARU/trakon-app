import { cn } from '@/components/ui/utils';

/**
 * 全ページ共通のページヘッダ。
 * タイトル・説明・パンくず・右側アクションをページごとに出し分ける。
 * - 通常: コンテナ内ヘッダ
 * - fullWidth: 画面全幅に下線を引くヘッダ (スケジュール等のキャンバス系)
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  fullWidth = false,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  fullWidth?: boolean;
  className?: string;
}) {
  const inner = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        {breadcrumb && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">{breadcrumb}</div>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );

  if (fullWidth) {
    return (
      <header className={cn('border-b border-border px-8 py-4', className)}>{inner}</header>
    );
  }
  return <header className={className}>{inner}</header>;
}
