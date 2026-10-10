import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ZoomControl } from './ZoomControl';

describe('ZoomControl', () => {
  it('既定の行高 (35px) ではつまみが真ん中にある (#268)', () => {
    render(<ZoomControl rowHeight={35} onChange={vi.fn()} />);
    const slider = screen.getByRole('slider', { name: '行の高さ' }) as HTMLInputElement;
    expect(slider.value).toBe('50');
    expect(slider).toHaveAttribute('aria-valuetext', '35px');
  });

  it('矢印キーは目盛りに関係なく 1 段階 (5px) ずつ動かす', () => {
    const onChange = vi.fn();
    render(<ZoomControl rowHeight={25} onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: '行の高さ' });

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(20);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(30);
  });

  it('端では範囲の外へ出ない', () => {
    const onChange = vi.fn();
    render(<ZoomControl rowHeight={80} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '拡大' }));
    expect(onChange).toHaveBeenLastCalledWith(80);
  });
});
