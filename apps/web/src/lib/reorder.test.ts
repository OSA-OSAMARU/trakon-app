import { describe, expect, it } from 'vitest';

import { moveItem } from './reorder';

describe('moveItem', () => {
  it('前方へ移動する', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 2, 0)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('後方へ移動する', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('末尾へ移動する', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('from === to は元の配列をそのまま返す', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 1, 1)).toBe(list);
  });

  it('範囲外インデックスは元の配列をそのまま返す', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 0, 5)).toBe(list);
    expect(moveItem(list, -1, 0)).toBe(list);
  });

  it('元の配列を変更しない', () => {
    const list = ['a', 'b', 'c'];
    moveItem(list, 0, 2);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});
