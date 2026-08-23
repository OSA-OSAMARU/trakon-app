import { ZoomIn, ZoomOut } from 'lucide-react';

import { ROW_HEIGHT_MAX, ROW_HEIGHT_MIN, ROW_HEIGHT_STEP } from '../scheduleLayout';

/** 行高 (＝縦横ズーム) を変える浮遊コントロール (Figma node 11:139)。 */
export function ZoomControl({
  rowHeight,
  onChange,
}: {
  rowHeight: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="shadow-float fixed right-6 bottom-6 z-40 flex h-11 w-40 items-center justify-between rounded-xl bg-background px-3">
      <button
        type="button"
        aria-label="縮小"
        className="text-text-secondary hover:text-foreground"
        onClick={() => onChange(Math.max(ROW_HEIGHT_MIN, rowHeight - ROW_HEIGHT_STEP))}
      >
        <ZoomOut className="size-5" />
      </button>
      <input
        type="range"
        min={ROW_HEIGHT_MIN}
        max={ROW_HEIGHT_MAX}
        step={ROW_HEIGHT_STEP}
        value={rowHeight}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-primary mx-2 h-[3px] w-[70px]"
        aria-label="行の高さ"
        aria-valuetext={`${rowHeight}px`}
      />
      <button
        type="button"
        aria-label="拡大"
        className="text-text-secondary hover:text-foreground"
        onClick={() => onChange(Math.min(ROW_HEIGHT_MAX, rowHeight + ROW_HEIGHT_STEP))}
      >
        <ZoomIn className="size-5" />
      </button>
    </div>
  );
}
