import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { Avatar } from './avatar';

describe('Avatar', () => {
  it('src が無ければイニシャルを出す', () => {
    render(<Avatar name="山田 太郎" />);
    expect(screen.getByText('山')).toBeInTheDocument();
  });

  it('名前が空なら ? を出す', () => {
    render(<Avatar name="   " />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('src があれば画像を出す', () => {
    const { container } = render(<Avatar name="山田 太郎" src="https://signed.test/a.webp" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://signed.test/a.webp');
    expect(screen.queryByText('山')).not.toBeInTheDocument();
  });

  it('画像の読み込みに失敗したらイニシャルへ落ちる (署名 URL の期限切れ対策)', () => {
    const { container } = render(<Avatar name="山田 太郎" src="https://signed.test/gone.webp" />);
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByText('山')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('src が差し替わると失敗状態がリセットされる', () => {
    const { container, rerender } = render(<Avatar name="山田" src="https://signed.test/1.webp" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    rerender(<Avatar name="山田" src="https://signed.test/2.webp" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://signed.test/2.webp');
  });
});
