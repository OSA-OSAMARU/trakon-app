import { ZoomIn, ZoomOut } from 'lucide-react';

import type { KeyboardEvent } from 'react';

import {
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_STEP,
  ZOOM_SLIDER_MAX,
  rowHeightToSlider,
  sliderToRowHeight,
} from '../scheduleLayout';

/** 行高 (＝縦横ズーム) を変える浮遊コントロール (Figma node 11:139)。 */
export function ZoomControl({
  rowHeight,
  onChange,
}: {
  rowHeight: number;
  onChange: (v: number) => void;
}) {
  const zoomOut = () => onChange(Math.max(ROW_HEIGHT_MIN, rowHeight - ROW_HEIGHT_STEP));
  const zoomIn = () => onChange(Math.min(ROW_HEIGHT_MAX, rowHeight + ROW_HEIGHT_STEP));

  // 目盛りが左右で違う (#268) ため、矢印キーはつまみ位置ではなく行高で 1 段階ずつ動かす。
  // ブラウザ任せだと左半分では数回押さないと変わらない。
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      zoomOut();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      zoomIn();
    }
  };

  return (
    <div className="shadow-float fixed right-6 bottom-6 z-40 flex h-11 w-40 items-center justify-between rounded-xl bg-background px-3">
      <button
        type="button"
        aria-label="縮小"
        className="text-text-secondary hover:text-foreground"
        onClick={zoomOut}
      >
        <ZoomOut className="size-5" />
      </button>
      <input
        type="range"
        // 値はつまみ位置 (既定の行高が真ん中に来る目盛り、#268)。行高は aria-valuetext で伝える
        min={0}
        max={ZOOM_SLIDER_MAX}
        step="any"
        value={rowHeightToSlider(rowHeight)}
        onChange={(e) => onChange(sliderToRowHeight(Number(e.target.value)))}
        onKeyDown={onKeyDown}
        className="accent-primary mx-2 h-[3px] w-[70px]"
        aria-label="行の高さ"
        aria-valuetext={`${rowHeight}px`}
      />
      <button
        type="button"
        aria-label="拡大"
        className="text-text-secondary hover:text-foreground"
        onClick={zoomIn}
      >
        <ZoomIn className="size-5" />
      </button>
    </div>
  );
}
