import { useEffect, useState } from 'react';

import { cn } from './utils';

/**
 * アバター。画像があれば表示し、無い / 読み込めない場合はイニシャルにフォールバックする
 * (Radix 依存なし)。サイズは className（例: `size-8 text-xs`）で指定する。
 *
 * 画像の URL は署名付きで有効期限があるため (#157)、期限切れや Storage 不通で
 * 読み込みに失敗しうる。その場合に空白を出さないよう必ずイニシャルへ落とす。
 */
export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  /** プロフィール画像の URL。null / undefined ならイニシャル表示 */
  src?: string | null;
  className?: string;
}) {
  const initial = (name?.trim() || '?').charAt(0).toUpperCase();
  const [failed, setFailed] = useState(false);

  // src が差し替わったら失敗状態をリセットする (アップロード直後に効く)
  useEffect(() => setFailed(false), [src]);

  const base = 'flex shrink-0 items-center justify-center overflow-hidden rounded-full';

  if (src && !failed) {
    return (
      <span className={cn(base, 'bg-muted', className)}>
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
          aria-hidden
        />
      </span>
    );
  }

  return (
    <span
      className={cn(base, 'bg-primary text-primary-foreground font-semibold', className)}
      aria-hidden
    >
      {initial}
    </span>
  );
}
