import { CheckCircle2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import type { MemberRef } from '../api';
import { COLUMN_HEADER_HEIGHT } from './DateAxis';

/**
 * 制作物列のヘッダー (Figma node 10:5)。
 *
 * 制作物名・現在のボール保持者・件数を並べる。全予定が完了していればボール保持者の
 * 代わりに「完了」と表示し、件数バッジを FIX バッジに差し替える。
 */
export function ColumnHeader({
  name,
  planCount,
  holders,
  allCompleted,
}: {
  name: string;
  planCount: number;
  holders: MemberRef[];
  allCompleted: boolean;
}) {
  return (
    <div
      className="border-grid-border sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-[18px]"
      style={{ height: COLUMN_HEADER_HEIGHT }}
    >
      {allCompleted && <CheckCircle2 className="text-success size-4 shrink-0" aria-hidden />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="text-text-secondary flex min-w-0 items-center gap-0.5 text-mini">
          <span className="shrink-0">ボール：</span>
          <span className="truncate">
            {allCompleted
              ? '完了'
              : holders.length > 0
                ? holders
                    .map((h) => (h.organizationName ? `${h.organizationName} ${h.name}` : h.name))
                    .join('、')
                : '—'}
          </span>
        </span>
      </div>
      {allCompleted ? (
        <Badge variant="success" shape="pill" size="lg" className="shrink-0">
          FIX
        </Badge>
      ) : (
        <Badge variant="neutral" shape="pill" size="lg" className="shrink-0">
          {planCount}件
        </Badge>
      )}
    </div>
  );
}
