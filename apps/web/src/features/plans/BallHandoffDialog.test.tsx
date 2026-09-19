import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BallHandoffDialog } from './BallHandoffDialog';

// Radix Dialog が jsdom に無い API を呼ぶためシムを入れる。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
});

function renderDialog(
  over: Partial<React.ComponentProps<typeof BallHandoffDialog>> = {},
) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <BallHandoffDialog
      kind="review-request"
      open
      onClose={onClose}
      onSubmit={onSubmit}
      pending={false}
      planTitle="Webデザイン"
      contextLabel="灯和食品｜ブランドサイト"
      handoffLabel="杉野 遥 → 石原 美咲"
      {...over}
    />,
  );
  return { onSubmit, onClose };
}

describe('BallHandoffDialog', () => {
  it('確認TOSS: 何のボールをどこへ渡すかを押す前に見せる', () => {
    renderDialog();

    expect(screen.getByRole('heading', { name: '確認TOSS' })).toBeInTheDocument();
    expect(screen.getByText('Webデザイン')).toBeInTheDocument();
    expect(screen.getByText('灯和食品｜ブランドサイト')).toBeInTheDocument();
    expect(screen.getByText('杉野 遥 → 石原 美咲')).toBeInTheDocument();
    expect(screen.getByText(/メッセージは承認者へ通知され/)).toBeInTheDocument();
  });

  it('確認TOSS: メッセージは任意なので、空のままでも渡せる', async () => {
    const { onSubmit } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: '確認TOSSする' }));
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('確認TOSS: 入力した内容がそのまま渡る', async () => {
    const { onSubmit } = renderDialog();

    await userEvent.type(
      screen.getByLabelText('確認してほしい内容（任意）'),
      'コピーと写真のバランスをご確認ください',
    );
    await userEvent.click(screen.getByRole('button', { name: '確認TOSSする' }));

    expect(onSubmit).toHaveBeenCalledWith('コピーと写真のバランスをご確認ください');
  });

  it('コメントRETURN: 理由が空なら渡さずエラーを出す', async () => {
    // 理由が無いと実施者は何を直せばよいか分からない
    const { onSubmit } = renderDialog({ kind: 'comment-return' });

    await userEvent.click(screen.getByRole('button', { name: 'RETURNする' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('戻す内容を入力してください')).toBeInTheDocument();
  });

  it('コメントRETURN: 空白だけの入力も理由として認めない', async () => {
    const { onSubmit } = renderDialog({ kind: 'comment-return' });

    await userEvent.type(screen.getByLabelText('戻す内容'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'RETURNする' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('コメントRETURN: 理由を入れれば渡せる', async () => {
    const { onSubmit } = renderDialog({ kind: 'comment-return' });

    await userEvent.type(screen.getByLabelText('戻す内容'), '写真を差し替えてください');
    await userEvent.click(screen.getByRole('button', { name: 'RETURNする' }));

    expect(onSubmit).toHaveBeenCalledWith('写真を差し替えてください');
  });

  it('相手が未設定のときは「誰から誰へ」を出さない', () => {
    renderDialog({ handoffLabel: null });
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it('送信中は操作を止める', () => {
    renderDialog({ kind: 'toss', pending: true });
    expect(screen.getByRole('button', { name: /TOSSする/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
  });
});
