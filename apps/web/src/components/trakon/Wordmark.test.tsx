import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  it('ロゴタイプ用のディスプレイ書体で描画する', () => {
    render(<Wordmark />);
    const el = screen.getByText('TRAKON');
    expect(el.className).toContain('font-display');
    expect(el.className).toContain('text-wordmark');
  });

  it('公開ページ向けに小さいサイズを選べる', () => {
    render(<Wordmark size="sm" />);
    expect(screen.getByText('TRAKON').className).toContain('text-xl');
  });
});
