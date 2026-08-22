import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('同じグループの後勝ちは従来どおり', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-foreground', 'text-primary-foreground')).toBe('text-primary-foreground');
  });

  it('独自のフォントサイズは文字色を打ち消さない', () => {
    // tailwind-merge に font-size として教えていないと text-primary-foreground が消える
    expect(cn('text-primary-foreground', 'text-body')).toBe('text-primary-foreground text-body');
    expect(cn('text-success', 'text-mini')).toBe('text-success text-mini');
  });

  it('独自のフォントサイズ同士は後勝ちになる', () => {
    expect(cn('text-mini', 'text-body')).toBe('text-body');
    expect(cn('text-body', 'text-sm')).toBe('text-sm');
  });
});
