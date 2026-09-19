import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DateField } from './date-field';

// Radix Popover が jsdom に無い API を呼ぶためシムを入れる。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
});

describe('DateField', () => {
  it('カレンダーで選んだ日付を input に書き戻す (#196)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<DateField aria-label="開始日" defaultValue="2026-09-08" />);

    await user.click(screen.getByRole('button', { name: 'カレンダーを開く' }));
    await user.click(await screen.findByRole('button', { name: '2026年9月20日' }));

    expect(screen.getByLabelText('開始日')).toHaveValue('2026-09-20');
  });

  it('カレンダーからの選択でも onChange が通常の入力と同じ形で発火する', async () => {
    // React はネイティブの value セッターを差し替えているため、
    // 素朴な el.value 代入では購読側 (React Hook Form など) に伝わらない
    const onChange = vi.fn();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<DateField aria-label="開始日" defaultValue="2026-09-08" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'カレンダーを開く' }));
    await user.click(await screen.findByRole('button', { name: '2026年9月20日' }));

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as React.ChangeEvent<HTMLInputElement>;
    expect(last.target.value).toBe('2026-09-20');
  });

  it('キーボードでの直接入力はこれまでどおり効く', async () => {
    const user = userEvent.setup();
    render(<DateField aria-label="開始日" />);

    const input = screen.getByLabelText('開始日');
    await user.type(input, '2026-10-01');

    expect(input).toHaveValue('2026-10-01');
  });

  it('min / max はカレンダー側にも効く', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <DateField aria-label="開始日" defaultValue="2026-09-08" min="2026-09-05" max="2026-09-20" />,
    );

    await user.click(screen.getByRole('button', { name: 'カレンダーを開く' }));

    expect(await screen.findByRole('button', { name: '2026年9月4日' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2026年9月21日' })).toBeDisabled();
  });

  it('無効時はカレンダーを開けない', () => {
    render(<DateField aria-label="開始日" disabled />);
    expect(screen.getByRole('button', { name: 'カレンダーを開く' })).toBeDisabled();
  });
});
