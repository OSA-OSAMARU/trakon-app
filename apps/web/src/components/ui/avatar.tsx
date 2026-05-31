import { cn } from './utils';

/**
 * イニシャル表示の軽量アバター (Radix 依存なし)。
 * サイズは className（例: `size-8 text-xs`）で指定する。
 */
export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const initial = (name?.trim() || '?').charAt(0).toUpperCase();
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground',
        className,
      )}
      aria-hidden
    >
      {initial}
    </span>
  );
}
