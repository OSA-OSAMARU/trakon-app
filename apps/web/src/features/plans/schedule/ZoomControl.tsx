import { ZoomIn, ZoomOut } from 'lucide-react';

import {
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_STEP,
} from '../scheduleLayout';

/** 行高 (＝縦横ズーム) を変える浮遊コントロール。 */
export function ZoomControl({
  rowHeight,
  onChange,
}: {
  rowHeight: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-lg border border-border bg-background p-3 shadow-lg">
      <button
        type="button"
        aria-label="縮小"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => onChange(Math.max(ROW_HEIGHT_MIN, rowHeight - ROW_HEIGHT_STEP))}
      >
        <ZoomOut className="size-4" />
      </button>
      <input
        type="range"
        min={ROW_HEIGHT_MIN}
        max={ROW_HEIGHT_MAX}
        step={ROW_HEIGHT_STEP}
        value={rowHeight}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 accent-primary"
        aria-label="行の高さ"
      />
      <button
        type="button"
        aria-label="拡大"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => onChange(Math.min(ROW_HEIGHT_MAX, rowHeight + ROW_HEIGHT_STEP))}
      >
        <ZoomIn className="size-4" />
      </button>
      <span className="ml-1 min-w-[2.5rem] text-xs text-muted-foreground">{rowHeight}px</span>
    </div>
  );
}
