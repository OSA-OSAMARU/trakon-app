import { cn } from '@/components/ui/utils';

const WIDTHS = {
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
} as const;

/**
 * 認証ページの共通コンテンツコンテナ。
 * 最大幅・左右余白・縦リズムを全ページで統一する。
 * - md: フォーム系 (作成/編集)
 * - lg: 一覧/ダッシュボード (既定)
 * - xl: テーブル系 (参加者管理など)
 */
export function PageContainer({
  width = 'lg',
  className,
  children,
}: {
  width?: keyof typeof WIDTHS;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('mx-auto flex w-full flex-col gap-6 px-6 py-8', WIDTHS[width], className)}>
      {children}
    </div>
  );
}
