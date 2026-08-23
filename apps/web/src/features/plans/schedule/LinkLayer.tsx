import { cn } from '@/components/ui/utils';

import type { Plan } from '../api';
import { chipVerticalBounds, dayIndex, planRange } from '../scheduleLayout';

/**
 * 後続リンクの端点。カード配置 (BallChip) と同じ chipVerticalBounds を使い、
 * 線とカードがずれないようにする。
 */
function chipCenters(
  plan: Plan,
  days: Date[],
  rowHeight: number,
  laneWidth: number,
  laneOf: Map<string, number>,
) {
  const { start, end } = planRange(plan);
  const startIdx = dayIndex(days, start);
  const endIdx = dayIndex(days, end);
  const { top, bottom } = chipVerticalBounds(startIdx, endIdx, rowHeight);
  const lane = laneOf.get(plan.id) ?? 0;
  const cx = lane * laneWidth + 6 + (laneWidth - 12) / 2;
  return { cx, top, bottom };
}

/**
 * 後続矢印の marker 定義。
 *
 * 列ごとの SVG に <defs> を持たせると同じ id が列数だけ重複してしまうため、
 * ボードに 1 つだけ描画して全列から参照する。
 */
export const SUCC_ARROW_ID = 'trakon-succ-arrow';
export const SUCC_ARROW_HL_ID = 'trakon-succ-arrow-hl';

export function LinkArrowDefs() {
  return (
    <svg className="pointer-events-none absolute size-0" aria-hidden>
      <defs>
        <marker
          id={SUCC_ARROW_ID}
          markerWidth="7"
          markerHeight="7"
          refX="5"
          refY="3.5"
          orient="auto"
        >
          <path d="M0,0 L7,3.5 L0,7 Z" className="fill-toss-line" />
        </marker>
        <marker
          id={SUCC_ARROW_HL_ID}
          markerWidth="8"
          markerHeight="8"
          refX="5.5"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" className="fill-toss-line-strong" />
        </marker>
      </defs>
    </svg>
  );
}

/** 列内の後続コネクトを描く SVG オーバーレイ。 */
export function LinkLayer({
  plans,
  laneOf,
  days,
  rowHeight,
  laneWidth,
  width,
  height,
  highlightSourceIds = null,
  dimOthers = false,
}: {
  plans: Plan[];
  laneOf: Map<string, number>;
  days: Date[];
  rowHeight: number;
  laneWidth: number;
  width: number;
  height: number;
  /** チェーン強調対象 (先行 plan の id 集合)。null ならホバー強調なし */
  highlightSourceIds?: Set<string> | null;
  /** ホバー中、チェーン外のリンクを減光するか */
  dimOthers?: boolean;
}) {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const links: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    sourceId: string;
    /** TOSS 済みなら「誰が渡したか」を線に添える (Figma node 32:10) */
    tossedBy: string | null;
  }[] = [];
  for (const p of plans) {
    if (!p.successorPlanId) continue;
    const succ = byId.get(p.successorPlanId);
    if (!succ) continue; // 別制作物 or 未ロード
    const a = chipCenters(p, days, rowHeight, laneWidth, laneOf);
    const b = chipCenters(succ, days, rowHeight, laneWidth, laneOf);
    links.push({
      x1: a.cx,
      y1: a.bottom,
      x2: b.cx,
      y2: b.top,
      sourceId: p.id,
      tossedBy: p.ballState === 'tossed' ? (p.fromMember?.name ?? null) : null,
    });
  }
  if (links.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20"
      width={width}
      height={height}
      style={{ overflow: 'visible' }}
      aria-hidden
    >
      {links.map((l, i) => {
        const midY = (l.y1 + l.y2) / 2;
        const d = `M ${l.x1} ${l.y1} C ${l.x1} ${midY}, ${l.x2} ${midY}, ${l.x2} ${l.y2}`;
        const highlighted = highlightSourceIds?.has(l.sourceId) ?? false;
        const dimmed = dimOthers && !highlighted;
        return (
          <g key={i} className={cn(dimmed && 'opacity-30')}>
            {/* 白い裏地 (halo): 背景色差に負けず線を浮き立たせる */}
            <path
              d={d}
              strokeWidth={highlighted ? 5 : 4}
              className="fill-none stroke-background opacity-80"
            />
            <path
              d={d}
              strokeWidth={highlighted ? 2.5 : 2}
              strokeDasharray="4 3"
              markerEnd={`url(#${highlighted ? SUCC_ARROW_HL_ID : SUCC_ARROW_ID})`}
              className={cn('fill-none', highlighted ? 'stroke-toss-line-strong' : 'stroke-toss-line')}
            />
            {/* 線が十分に伸びているときだけ「◯◯がTOSS」を添える */}
            {l.tossedBy && l.y2 - l.y1 >= 32 && (
              <text
                x={l.x1 + 6}
                y={midY}
                className="fill-toss-line text-micro font-bold"
                dominantBaseline="middle"
              >
                {l.tossedBy}がTOSS
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
