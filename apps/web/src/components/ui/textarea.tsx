import * as React from 'react';

import { cn } from './utils';

/**
 * 複数行入力 (Figma node 342:90 / Form/Text Field に準じる)。
 * 高さ以外の余白・角丸・状態表現は Input と揃える。
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
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
}

export { Textarea };
