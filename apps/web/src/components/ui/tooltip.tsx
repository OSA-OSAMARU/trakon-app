'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from './utils';

/**
 * ツールチップ。Figma の履歴タブで相対時刻に絶対日時を重ねる表示 (node 49:2) が該当。
 * 濃色の面に白文字を載せる。
 */

const TooltipProvider = TooltipPrimitive.Provider;
const TooltipTrigger = TooltipPrimitive.Trigger;

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipPrimitive.Provider>
  );
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-primary text-primary-foreground z-50 w-fit rounded-md px-3 py-1.5 text-mini shadow-float',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
