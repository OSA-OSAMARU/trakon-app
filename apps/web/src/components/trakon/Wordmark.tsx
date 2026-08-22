import type * as React from 'react';

import { cn } from '@/components/ui/utils';

/**
 * TRAKON ワードマーク (Figma node 33:19 / 9:3)。
 *
 * ロゴタイプは Sora / SemiBold で確定している。Figma に独立したシンボルマークは
 * 存在せず、ワードマークそのものがロゴなので、画像ではなく Sora のライブテキストで
 * 描画する（拡大に強く、文字色をトークンで切り替えられる）。
 */
const SIZES = {
  /** 公開ページのヘッダー */
  sm: 'text-xl',
  /** サイドバー (Figma 32px) */
  md: 'text-wordmark',
} as const;

type WordmarkProps = React.ComponentProps<'span'> & {
  size?: keyof typeof SIZES;
};

export function Wordmark({ size = 'md', className, ...props }: WordmarkProps) {
  return (
    <span
      data-slot="wordmark"
      className={cn('font-display font-semibold tracking-normal', SIZES[size], className)}
      {...props}
    >
      TRAKON
    </span>
  );
}
