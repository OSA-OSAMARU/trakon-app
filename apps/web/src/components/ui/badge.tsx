'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from './utils';

/**
 * バッジ / ステータス pill (Figma node 10:9, 10:15, 11:19, 11:46, 18:10)。
 *
 * Figma には形の異なる 2 系統がある。
 *   - 角丸の小ラベル (プランバッジ「PRO」「必須」)           → shape="rounded"
 *   - 完全な pill (列ヘッダーの件数 / FIX、カード内の状態表示) → shape="pill"
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap border font-medium [&>svg]:pointer-events-none [&>svg]:size-3.5 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive transition-[color,box-shadow]",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        /** 件数バッジなど、意味を持たない中立の表示 */
        neutral: 'border-transparent bg-surface-subtle text-text-secondary',
        /** FIX・承認済み */
        success: 'border-transparent bg-success-subtle text-success',
        /** 進行中 */
        warning: 'border-transparent bg-warning-subtle text-warning',
        /** 遅延・期限超過 */
        danger: 'border-transparent bg-danger-subtle text-danger',
        /** プランバッジ「PRO」・「必須」ラベル */
        brand: 'border-transparent bg-brand-badge text-brand-strong',
        destructive: 'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90',
        outline: 'border-border bg-background text-foreground [a&]:hover:bg-accent',
      },
      shape: {
        rounded: 'rounded-md',
        pill: 'rounded-full',
      },
      size: {
        sm: 'h-5 px-2 text-micro',
        default: 'h-6 px-2.5 text-mini',
        lg: 'h-[26px] px-3 text-mini',
      },
    },
    defaultVariants: {
      variant: 'default',
      shape: 'rounded',
      size: 'default',
    },
  },
);

function Badge({
  className,
  variant,
  shape,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, shape, size, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
