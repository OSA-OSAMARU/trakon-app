'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';

import { cn } from './utils';

/**
 * ボタン (Figma「03 Button / Guide v1.0」node 237:40、実体 469:304 / 470:304)。
 *
 * ガイドが定める指定軸は Role / State / Label / Focus の 4 つ。
 *   Role=Brand     中心操作 (次の工程へトス)      … TRAKON オレンジ
 *   Role=Primary   画面の主操作 (承認・保存・確定) … 黒
 *   Role=Secondary 補助操作 (キャンセル・戻る)     … 白 + 枠線
 * State は Default / Hover / Pressed / Disabled / Loading。画面側で独自の色を
 * 作らず、同じ Button の State を切り替える。視覚遷移は 100ms。
 *
 * ghost / link / destructive はガイドの範囲外だが、削除操作やアイコンのみの
 * 行内操作でアプリが必要としているためコードベース独自の Role として残す。
 *
 * 高さは Figma のコンポーネントセットに合わせて 3 段。
 *   sm      36px … Button / Small (469:304)。「今日」「メンバー」など副次操作
 *   default 40px … Header (419:132) の操作行で実測される密度
 *   lg      44px … Button / Large (470:304)。フォーム・主要操作の標準
 *
 * ラベルを含むサイズには pb-[0.11em] を入れている。Noto Sans JP は行ボックスが
 * 上下非対称 (hhea ascent 1.16em / descent 0.288em) で、字面の中心が行ボックスの
 * 中心より約 0.056em 下に来る。items-center だけだとラベルが沈んで見えるため、
 * その 2 倍を下パディングで相殺して光学的に中央へ戻す (アイコンのみの size は対象外)。
 */
const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border',
    'text-button font-medium transition-all duration-100',
    // Focus は Role / State とは独立 (ガイド §04)。ring ではなく outline を使うのは、
    // ring-offset が白固定になりベージュのページ背景に白い隙間が出るのを避けるため。
    'outline-none focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2',
    'disabled:pointer-events-none',
    // アイコンは Button 内 16px 固定 (Figma「04 ICON」node 286:90)
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    'aria-invalid:border-destructive',
  ].join(' '),
  {
    variants: {
      /** ガイドの Role プロパティに 1:1 対応する。既定は画面の主操作 (黒)。 */
      variant: {
        brand:
          'border-brand bg-brand text-brand-foreground hover:border-brand-strong hover:bg-brand-strong active:border-brand-pressed active:bg-brand-pressed disabled:border-action-disabled-border disabled:bg-action-disabled disabled:text-action-disabled-foreground',
        primary:
          'border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover active:border-primary-pressed active:bg-primary-pressed disabled:border-action-disabled-border disabled:bg-action-disabled disabled:text-action-disabled-foreground',
        secondary:
          'border-input bg-background text-foreground hover:bg-secondary-hover active:bg-secondary-pressed disabled:border-action-disabled-border disabled:bg-action-disabled disabled:text-action-disabled-foreground',
        /** ガイド範囲外: 破壊的操作 */
        destructive:
          'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50',
        /** ガイド範囲外: 行内のアイコン操作・メニュー項目 */
        ghost: 'border-transparent hover:bg-accent hover:text-accent-foreground disabled:opacity-50',
        /** ガイド範囲外: 文中リンク */
        link: 'border-transparent text-primary underline-offset-4 hover:underline disabled:opacity-50',
      },
      size: {
        sm: 'h-9 px-3 pb-[0.11em]', // 36px / padding-inline 12
        default: 'h-10 px-4 pb-[0.11em]', // 40px / padding-inline 16
        lg: 'h-11 px-4 pb-[0.11em]', // 44px / padding-inline 16
        icon: 'size-10',
        'icon-sm': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  onClick,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /**
     * 処理中 (ガイド 237:40 §05)。Spinner を出し aria-busy を立て、二重実行を防ぐ。
     * Disabled とは別扱いなので配色は変えない。ラベルは呼び出し側が
     * 「保存中…」のように具体化してよい。
     * asChild=true のときは子要素が 1 つに限られるため Spinner は描画しない。
     */
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  return (
    <Comp
      data-slot="button"
      data-loading={loading ? '' : undefined}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), loading && 'cursor-wait', className)}
      onClick={handleClick}
      {...props}
    >
      {/* asChild は Slot が子要素 1 つを要求するため、children をそのまま渡す */}
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
