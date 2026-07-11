import { useState } from 'react';

/** list の from 番目を to 番目へ移動した新しい配列を返す (元配列は変更しない)。 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list;
  }
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * ネイティブ HTML5 ドラッグ&ドロップによる縦リストの並び替えフック (#111)。
 * - `handleProps(index)`: ドラッグの起点となるグリップ要素に付与する。
 * - `rowProps(index)`: ドロップ対象となる各行に付与する。
 * onReorder(from, to) はドロップ時に一度だけ呼ばれる。
 */
export function useDragReorder(onReorder: (from: number, to: number) => void) {
  const [fromIndex, setFromIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const reset = () => {
    setFromIndex(null);
    setOverIndex(null);
  };

  return {
    fromIndex,
    overIndex,
    isDragging: fromIndex !== null,
    handleProps: (index: number) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setFromIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        // Firefox はドラッグ開始に setData が必須。
        e.dataTransfer.setData('text/plain', String(index));
      },
      onDragEnd: reset,
    }),
    rowProps: (index: number) => ({
      onDragOver: (e: React.DragEvent) => {
        if (fromIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (overIndex !== index) setOverIndex(index);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (fromIndex !== null && fromIndex !== index) onReorder(fromIndex, index);
        reset();
      },
    }),
  };
}
