import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/utils';

import { PLAN_STATUS_SPEC, type PlanStatus } from './planStatus';

type StatusPillProps = Omit<React.ComponentProps<typeof Badge>, 'variant' | 'shape' | 'children'> & {
  status: PlanStatus;
  /** アイコンを省いてラベルだけにする */
  hideIcon?: boolean;
};

/**
 * 予定の状態表示 pill。カード上・列ヘッダー・サイドモーダルで共有する。
 * 定義は ./planStatus.ts を参照。
 */
export function StatusPill({ status, hideIcon, className, ...props }: StatusPillProps) {
  const spec = PLAN_STATUS_SPEC[status];
  return (
    <Badge
      data-slot="status-pill"
      data-status={status}
      variant={spec.variant}
      shape="pill"
      className={cn(className)}
      {...props}
    >
      {hideIcon ? null : <spec.Icon aria-hidden />}
      {spec.label}
    </Badge>
  );
}
