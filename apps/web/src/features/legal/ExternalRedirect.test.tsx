import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ExternalRedirect } from './ExternalRedirect';
import { LEGACY_LEGAL_PATHS, LEGAL_LINKS } from './legalLinks';

const externalRedirect = vi.fn();
vi.mock('@/lib/navigate', () => ({
  externalRedirect: (url: string) => externalRedirect(url),
}));

beforeEach(() => {
  externalRedirect.mockClear();
});

describe('ExternalRedirect', () => {
  it('描画されたら公式サイトへ遷移する', () => {
    render(<ExternalRedirect href={LEGAL_LINKS.terms} label="利用規約" />);
    expect(externalRedirect).toHaveBeenCalledWith('https://www.trakon.app/terms');
  });

  it('自動遷移しなかった場合に備えて手動リンクも出す', () => {
    render(<ExternalRedirect href={LEGAL_LINKS.privacy} label="プライバシーポリシー" />);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://www.trakon.app/privacy',
    );
    expect(screen.getByText(/プライバシーポリシーは公式サイトへ移動しました/)).toBeInTheDocument();
  });
});

describe('LEGACY_LEGAL_PATHS', () => {
  it('アプリ内に持っていた 4 パスをすべて公式サイトへ向ける (#193)', () => {
    expect(LEGACY_LEGAL_PATHS).toEqual([
      { path: '/company', href: 'https://www.trakon.app/company' },
      { path: '/terms', href: 'https://www.trakon.app/terms' },
      { path: '/privacy', href: 'https://www.trakon.app/privacy' },
      { path: '/commerce', href: 'https://www.trakon.app/commerce' },
    ]);
  });
});
