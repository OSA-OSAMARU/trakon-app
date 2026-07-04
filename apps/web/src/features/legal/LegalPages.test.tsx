import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/test/render';
import { TermsPage } from './TermsPage';
import { PrivacyPage } from './PrivacyPage';
import { CommercePage } from './CommercePage';

describe('法務ページ', () => {
  it('利用規約: 見出し・条項・附則・相互リンクを描画する', () => {
    renderWithProviders(<TermsPage />, { route: '/terms' });

    expect(screen.getByRole('heading', { level: 1, name: '利用規約' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '第1条（適用）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '第10条（禁止事項）' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: '第25条（準拠法および管轄）' }),
    ).toBeInTheDocument();
    // 箇条書き (LegalList) の項目が描画されている
    expect(screen.getByText(/リバースエンジニアリング/)).toBeInTheDocument();
    // フッターの相互リンク
    expect(screen.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByText(/© 2026 株式会社おさまるカンパニー/)).toBeInTheDocument();
  });

  it('プライバシーポリシー: 見出し・取得情報・問い合わせ窓口を描画する', () => {
    renderWithProviders(<PrivacyPage />, { route: '/privacy' });

    expect(
      screen.getByRole('heading', { level: 1, name: 'プライバシーポリシー' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: '第2条（取得する情報）' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: '第14条（お問い合わせ窓口）' }),
    ).toBeInTheDocument();
    // 定義リスト (LegalDefList) の問い合わせ窓口の住所が描画されている
    expect(screen.getByText('埼玉県児玉郡神川町原新田21-20')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '特定商取引法に基づく表記' })).toHaveAttribute(
      'href',
      '/commerce',
    );
  });

  it('特定商取引法: 販売事業者と問い合わせメールを描画する', () => {
    renderWithProviders(<CommercePage />, { route: '/commerce' });

    expect(
      screen.getByRole('heading', { level: 1, name: '特定商取引法に基づく表記' }),
    ).toBeInTheDocument();
    expect(screen.getByText('販売事業者')).toBeInTheDocument();
    expect(screen.getByText('返品・キャンセル・返金について')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'trakon_contact@osamaru.com' })).toHaveAttribute(
      'href',
      'mailto:trakon_contact@osamaru.com',
    );
  });
});
