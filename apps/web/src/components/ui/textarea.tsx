import * as React from 'react';

import { cn } from './utils';

/**
 * 複数行入力 (Figma node 342:90 / Form/Text Field に準じる)。
 * 高さ以外の余白・角丸・状態表現は Input と揃える。
 *
 * forwardRef は必須 (#230)。react-hook-form の `register()` は ref を返すため、
 * React 18 で素の関数コンポーネントのままだと ref がどこにも届かず、
 * 検証エラー時のフォーカス移動などが黙って効かなくなる (Input は既に対応済み)。
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          'border-input bg-input-background placeholder:text-text-tertiary flex field-sizing-content min-h-16 w-full resize-none rounded-md border px-4 py-2.5 text-base transition-[color,box-shadow,border-color] outline-none md:text-body',
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

export { Textarea };
