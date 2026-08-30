'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from './utils';

/**
 * ボタン (Figma node 42:4 / 73:114 / 76:39 / 9:48)。
 *
 * 高さは Figma 実測に合わせて 3 段。
 *   sm      36px … 「今日」「メンバー」など副次操作
 *   default 40px … ヘッダーの主要操作
 *   lg      44px … フォームの標準 (node 78:18「標準高さ 44px」)
 * 左右余白は「通常 18px 以上 / 主要操作 24px 以上」(同 node 78:18)。
 *
 * ラベルを含むサイズには pb-[0.11em] を入れている。Noto Sans JP は行ボックスが
 * 上下非対称 (hhea ascent 1.16em / descent 0.288em) で、字面の中心が行ボックスの
 * 中心より約 0.056em 下に来る。items-center だけだとラベルが沈んで見えるため、
 * その 2 倍を下パディングで相殺して光学的に中央へ戻す (アイコンのみの size は対象外)。
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-3 whitespace-nowrap rounded-md font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        /** 「次の工程へトス」= 前進を促す唯一のブランド色ボタン。濃文字を載せる */
        accent: 'bg-brand text-foreground hover:bg-brand/90',
        destructive: 'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline: 'border border-input bg-background text-foreground hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 gap-2 px-3.5 pb-[0.11em] text-body has-[>svg]:px-3',
        default: 'h-10 px-4.5 pb-[0.11em] text-body has-[>svg]:px-4',
        lg: 'h-11 px-6 pb-[0.11em] text-body has-[>svg]:px-5',
        icon: 'size-10',
        'icon-sm': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
