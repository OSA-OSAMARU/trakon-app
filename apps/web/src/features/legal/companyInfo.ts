// =============================================================================
// 会社情報の共有定数。会社概要 / 特定商取引法 / プライバシーポリシー間で表記を統一する。
// 住所・電話番号は #112 で指定されたものを正とする。
// =============================================================================

export const COMPANY = {
  name: '株式会社おさまるカンパニー',
  representative: '宮丸 長（Osa MIYAMARU）',
  postalCode: '〒330-9501',
  address: '埼玉県さいたま市大宮区桜木町2丁目3番地 大宮マルイ7階',
  phone: '03-6110-0597',
  contactEmail: 'trakon_contact@osamaru.com',
  business: [
    'プロジェクト進行支援サービスの企画・開発・運営',
    'Web に関する企画・制作・運用支援',
  ],
} as const;

/** 郵便番号付きの完全な所在地表記。 */
export const COMPANY_ADDRESS_FULL = `${COMPANY.postalCode} ${COMPANY.address}`;

// 公開ページ (会社概要 / 利用規約 / プライバシーポリシー / 特定商取引法に基づく表記)。
// 公開ページ間の共通ヘッダー・フッター、およびアプリ内サイドバーの導線で共有する。
export const LEGAL_NAV: { to: string; label: string }[] = [
  { to: '/company', label: '会社概要' },
  { to: '/terms', label: '利用規約' },
  { to: '/privacy', label: 'プライバシーポリシー' },
  { to: '/commerce', label: '特定商取引法に基づく表記' },
];
