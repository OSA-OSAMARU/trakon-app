import * as React from 'react';

import { cn } from './utils';

/**
 * 入力欄 (Figma「06 Form Controls / Guide v1.0」node 342:90 / Form/Text Field)。
 *
 * 高さ 44px・角丸 8px (field/radius)・左右余白 16px (field/padding-inline)。
 * 状態は Default / Focus / Filled / Error / Disabled の 5 つで、
 * Focus はブランドオレンジの枠、Error は `aria-invalid` で赤枠になる。
 * ラベルと補足文を含めて一つの Field として扱う (補足文は呼び出し側)。
 *
 * `text-base md:text-body` は iOS Safari がフォーカス時に 16px 未満の入力欄を
 * 自動ズームするのを避けるための実装上の回避策で、デザイン指定ではない。
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          'file:text-foreground placeholder:text-text-tertiary selection:bg-primary selection:text-primary-foreground border-input bg-input-background flex h-11 w-full min-w-0 rounded-md border px-4 py-1 text-base transition-[color,box-shadow,border-color] outline-none md:text-body',
          'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-body file:font-medium',
          'focus-visible:border-brand focus-visible:ring-brand focus-visible:ring-1',
          'aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive',
          'disabled:bg-surface-subtle disabled:text-text-tertiary disabled:border-border disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
export { Input };
