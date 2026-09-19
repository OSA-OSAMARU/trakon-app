import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge は `text-*` の未知の値を既定で「文字色」と解釈する。
 * globals.css で追加した独自のフォントサイズ (text-body / text-mini など) を
 * 教えておかないと、`text-primary-foreground text-body` のような組み合わせで
 * 後勝ちにより文字色が捨てられてしまう。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'heading-page',
            'heading-section',
            'body',
            'button',
            'label',
            // スケジュール高密度表示専用 (globals.css 参照)
            'micro',
            'mini',
            'wordmark',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
