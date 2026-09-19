'use client';

import * as React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';

import { cn } from './utils';

/**
 * ラジオ選択 (Figma「06 Form Controls / Guide v1.0」node 342:90 / Form/Radio)。
 *
 * 1 項目の当たり判定は他のフォーム部品と同じ 44px 高。選択済みはブランドオレンジの
 * 枠と中心のドットで示し、Disabled は枠・文字ともに淡くする。
 * ラベルは項目と一体で押せるように `RadioGroupItem` 側で包む。
 */
function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-1', className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  children,
  id,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  const generatedId = React.useId();
  const itemId = id ?? generatedId;

  return (
    <div className="flex h-11 items-center gap-2">
      <RadioGroupPrimitive.Item
        id={itemId}
        data-slot="radio-group-item"
        className={cn(
          'peer border-input text-brand aspect-square size-5 shrink-0 rounded-full border transition-[color,box-shadow,border-color] outline-none',
          'focus-visible:border-brand focus-visible:ring-brand focus-visible:ring-1',
          'data-[state=checked]:border-brand',
          'aria-invalid:border-destructive',
          'disabled:border-action-disabled-border disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator
          data-slot="radio-group-indicator"
          className="relative flex items-center justify-center"
        >
          <span className="bg-brand size-2.5 rounded-full" />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
      {children != null && (
        <label
          htmlFor={itemId}
          className="text-body text-foreground peer-disabled:text-text-tertiary cursor-pointer select-none peer-disabled:cursor-not-allowed"
        >
          {children}
        </label>
      )}
    </div>
  );
}

export { RadioGroup, RadioGroupItem };
