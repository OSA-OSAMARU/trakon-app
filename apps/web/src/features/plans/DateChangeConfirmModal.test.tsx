import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import { DateChangeConfirmModal } from './DateChangeConfirmModal';

// Radix AlertDialog は jsdom に無い API を使うためシムを入れる。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
});

describe('DateChangeConfirmModal', () => {
  it('タイトル・説明・3 つのアクションを描画する', () => {
    renderWithProviders(
      <DateChangeConfirmModal ballName="デザイン" onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText('日程を変更しますか？')).toBeInTheDocument();
    // ballName が説明文に含まれる
    expect(screen.getByText(/「デザイン」の日程を変更します/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '次の予定（後続チェーン）も一緒にずらす' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'この予定のみ変更' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
  });

  it('「後続も一緒にずらす」を押すと onConfirm(true) が呼ばれる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <DateChangeConfirmModal ballName="X" onClose={onClose} onConfirm={onConfirm} />,
    );

    await user.click(
      screen.getByRole('button', { name: '次の予定（後続チェーン）も一緒にずらす' }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('「この予定のみ変更」を押すと onConfirm(false) が呼ばれる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onConfirm = vi.fn();
    renderWithProviders(
      <DateChangeConfirmModal ballName="X" onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    await user.click(screen.getByRole('button', { name: 'この予定のみ変更' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('「キャンセル」を押すと onClose が呼ばれ onConfirm は呼ばれない', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <DateChangeConfirmModal ballName="X" onClose={onClose} onConfirm={onConfirm} />,
    );

    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape で onOpenChange(false) → onClose が呼ばれる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onClose = vi.fn();
    renderWithProviders(
      <DateChangeConfirmModal ballName="X" onClose={onClose} onConfirm={vi.fn()} />,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
