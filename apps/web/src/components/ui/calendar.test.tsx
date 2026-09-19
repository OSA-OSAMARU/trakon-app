import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Calendar } from './calendar';

const TODAY = new Date('2026-09-12T00:00:00');

function renderCalendar(over: Partial<React.ComponentProps<typeof Calendar>> = {}) {
  const onSelect = vi.fn();
  render(<Calendar value="2026-09-08" onSelect={onSelect} today={TODAY} {...over} />);
  return { onSelect };
}

/** 日付セルの丸 (状態を表す span) を取り出す。 */
function circle(label: string): HTMLElement {
  return screen.getByRole('button', { name: label }).firstElementChild as HTMLElement;
}

describe('Calendar', () => {
  it('選択中の月と曜日の見出しを出す', () => {
    renderCalendar();
    expect(screen.getByText('2026年9月')).toBeInTheDocument();
    for (const w of ['日', '月', '火', '水', '木', '金', '土']) {
      expect(screen.getByText(w)).toBeInTheDocument();
    }
  });

  it('今日は輪郭、選択中は塗りつぶしで区別する', () => {
    // 「今日を選んでいる」のか「今日が見えているだけ」なのかを見分けられることが肝
    renderCalendar();

    expect(circle('2026年9月8日').className).toContain('bg-brand');
    expect(circle('2026年9月12日').className).toContain('border-brand');
    expect(circle('2026年9月12日').className).not.toContain('bg-brand');
  });

  it('当月外の日は淡色で出す', () => {
    renderCalendar();
    expect(circle('2026年8月30日').className).toContain('text-text-tertiary');
    expect(circle('2026年9月15日').className).not.toContain('text-text-tertiary');
  });

  it('日付を押すと ISO 文字列で返す', async () => {
    const { onSelect } = renderCalendar();
    await userEvent.click(screen.getByRole('button', { name: '2026年9月20日' }));
    expect(onSelect).toHaveBeenCalledWith('2026-09-20');
  });

  it('月を前後に送れる', async () => {
    renderCalendar();

    await userEvent.click(screen.getByRole('button', { name: '次の月' }));
    expect(screen.getByText('2026年10月')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '前の月' }));
    await userEvent.click(screen.getByRole('button', { name: '前の月' }));
    expect(screen.getByText('2026年8月')).toBeInTheDocument();
  });

  it('月を送っても常に 6 週分 (42 日) を描く', async () => {
    // 高さが変わるとポップオーバーが飛び跳ねて押し間違いの元になる
    renderCalendar();
    const count = () => screen.getAllByRole('button').length - 2; // 前後の月送りを除く
    expect(count()).toBe(42);

    await userEvent.click(screen.getByRole('button', { name: '次の月' }));
    expect(count()).toBe(42);
  });

  it('min / max の範囲外は押せない', async () => {
    const { onSelect } = renderCalendar({ min: '2026-09-05', max: '2026-09-20' });

    expect(screen.getByRole('button', { name: '2026年9月4日' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2026年9月21日' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2026年9月10日' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: '2026年9月4日' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('未選択でも今日の月から始まる', () => {
    renderCalendar({ value: null });
    expect(screen.getByText('2026年9月')).toBeInTheDocument();
    expect(circle('2026年9月12日').className).toContain('border-brand');
  });
});
