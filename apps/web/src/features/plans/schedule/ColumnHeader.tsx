import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/utils';

import type { MemberRef } from '../api';
import { itemColor } from '../scheduleLayout';

/** 制作物列のヘッダー (sticky top): 制作物名・件数・現在のボール保持者。 */
export function ColumnHeader({
  itemId,
  name,
  planCount,
  holders,
}: {
  itemId: string;
  name: string;
  planCount: number;
  holders: MemberRef[];
}) {
  const color = itemColor(itemId);
  return (
    <div className="sticky top-0 z-20 flex h-16 flex-col justify-center gap-0.5 border-b border-border bg-background px-3">
      <div className="flex items-center gap-2">
        <span className={cn('size-2.5 shrink-0 rounded-full', color.dot)} />
        <span className="truncate text-sm font-medium">{name}</span>
        <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
          {planCount}件
        </Badge>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <span className="shrink-0">ボール保持:</span>
        {holders.length > 0 ? (
          <span className="truncate font-medium text-foreground">
            {holders
              .map((h) => (h.organizationName ? `${h.organizationName} ${h.name}` : h.name))
              .join('、')}
          </span>
        ) : (
          <span>—</span>
        )}
      </div>
    </div>
  );
}
