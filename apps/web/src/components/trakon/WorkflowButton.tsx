import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';

import { WORKFLOW_ACTION_SPEC, type WorkflowAction } from './workflow';

type WorkflowButtonProps = Omit<React.ComponentProps<typeof Button>, 'variant' | 'children'> & {
  action: WorkflowAction;
  /** 既定ラベルを上書きする (取消系など、同じ見た目で文言だけ変えたい場合) */
  children?: React.ReactNode;
};

/** ボール操作ボタン (Figma node 42:4)。定義は ./workflow.ts を参照。 */
export function WorkflowButton({ action, className, children, ...props }: WorkflowButtonProps) {
  const spec = WORKFLOW_ACTION_SPEC[action];
  return (
    <Button
      data-slot="workflow-button"
      data-action={action}
      variant={spec.variant}
      // Figma は高さ 42px・角丸 8px・幅 208px。幅は置き場所で変わるため既定は伸縮させる
      className={cn('h-[42px] min-w-[160px] flex-1 rounded-md', className)}
      {...props}
    >
      {children ?? spec.label}
    </Button>
  );
}
