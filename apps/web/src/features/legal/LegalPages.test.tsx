import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { renderWithProviders } from '@/test/render';
import { TermsPage } from './TermsPage';
import { PrivacyPage } from './PrivacyPage';
import { CommercePage } from './CommercePage';
import { CompanyPage } from './CompanyPage';
import { COMPANY, COMPANY_ADDRESS_FULL } from './companyInfo';

describe('法務・会社情報ページ', () => {
  it('会社概要: 見出しと会社情報 (#112 の住所・電話) を描画する', () => {
    renderWithProviders(<CompanyPage />, { route: '/company' });

    expect(screen.getByRole('heading', { level: 1, name: '会社概要' })).toBeInTheDocument();
    expect(screen.getByText(COMPANY.name)).toBeInTheDocument();
    expect(screen.getByText(COMPANY.representative)).toBeInTheDocument();
    expect(screen.getByText(COMPANY_ADDRESS_FULL)).toBeInTheDocument();
    expect(screen.getByText(COMPANY.phone)).toBeInTheDocument();
  });

  it('共通ヘッダー: 会社概要を含む4ページへの相互リンクを描画する', () => {
    renderWithProviders(<TermsPage />, { route: '/terms' });

    const header = screen.getByRole('banner');
    for (const [name, href] of [
      ['会社概要', '/company'],
      ['利用規約', '/terms'],
      ['プライバシーポリシー', '/privacy'],
      ['特定商取引法に基づく表記', '/commerce'],
    ] as const) {
      expect(within(header).getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('利用規約: 見出し・条項・附則を描画する', () => {
    renderWithProviders(<TermsPage />, { route: '/terms' });

    expect(screen.getByRole('heading', { level: 1, name: '利用規約' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '第1条（適用）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '第10条（禁止事項）' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: '第25条（準拠法および管轄）' }),
    ).toBeInTheDocument();
    // 箇条書き (LegalList) の項目が描画されている
    expect(screen.getByText(/リバースエンジニアリング/)).toBeInTheDocument();
    // フッターの相互リンク (ヘッダーにも同名リンクがあるため getAllByRole で確認)
    expect(
      screen.getAllByRole('link', { name: 'プライバシーポリシー' })[0],
    ).toHaveAttribute('href', '/privacy');
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
    // 定義リスト (LegalDefList) の問い合わせ窓口の住所は #112 の新住所に統一されている
    expect(screen.getByText(COMPANY_ADDRESS_FULL)).toBeInTheDocument();
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
