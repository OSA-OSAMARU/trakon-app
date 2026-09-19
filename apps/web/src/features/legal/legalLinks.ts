// =============================================================================
// 会社情報・法務ページへの導線 (#193)
//
// これらのページは**公式サイト (www.trakon.app) が正**で、app.trakon.app 側では
// 持たない。二重管理すると規約改定のたびに片方が古くなり、どちらが有効な規約か
// 言えなくなるため。アプリからは常に公式サイトへ送る。
//
// リンクは別タブで開く (target="_blank")。同意チェックの途中で入力内容を
// 失わせないための措置。
// =============================================================================

const SITE_ORIGIN = 'https://www.trakon.app';

export const LEGAL_LINKS = {
  company: `${SITE_ORIGIN}/company`,
  terms: `${SITE_ORIGIN}/terms`,
  privacy: `${SITE_ORIGIN}/privacy`,
  commerce: `${SITE_ORIGIN}/commerce`,
  contact: `${SITE_ORIGIN}/contact`,
} as const;

export type LegalLinkKey = keyof typeof LEGAL_LINKS;

export const LEGAL_LINK_LABEL: Record<LegalLinkKey, string> = {
  company: '会社概要',
  terms: '利用規約',
  privacy: 'プライバシーポリシー',
  commerce: '特定商取引法に基づく表記',
  contact: 'お問い合わせ',
};

/**
 * アプリ内に残していた頃のパス → 公式サイトの URL。
 *
 * ブックマークや過去に共有された URL を行き止まりにしないため、旧パスは
 * ルーティングで拾って公式サイトへ送る。
 */
export const LEGACY_LEGAL_PATHS: { path: string; href: string }[] = [
  { path: '/company', href: LEGAL_LINKS.company },
  { path: '/terms', href: LEGAL_LINKS.terms },
  { path: '/privacy', href: LEGAL_LINKS.privacy },
  { path: '/commerce', href: LEGAL_LINKS.commerce },
];

/** 画面に並べるときの順序。公式サイトのフッターと揃える。 */
export const LEGAL_LINK_ORDER: LegalLinkKey[] = [
  'company',
  'terms',
  'privacy',
  'commerce',
  'contact',
];
