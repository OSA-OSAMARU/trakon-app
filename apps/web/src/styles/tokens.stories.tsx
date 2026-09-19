import type { Meta, StoryObj } from '@storybook/react';

/* =============================================================================
 * デザイントークンのカタログ (globals.css の内容と 1:1 で対応)
 * 実装の見た目確認と、Figma との突き合わせに使う。
 * ============================================================================= */

type Swatch = { name: string; className: string; value: string; note?: string };

const SURFACES: Swatch[] = [
  { name: 'background', className: 'bg-background', value: '#FFFFFF', note: 'bg/surface カード・帯' },
  { name: 'content', className: 'bg-content', value: '#FAF8F4', note: 'bg/page 画面全体の土台' },
  { name: 'sidebar', className: 'bg-sidebar', value: '#FAF8F4', note: 'bg/page' },
  { name: 'surface-muted', className: 'bg-surface-muted', value: '#F3EFE8', note: 'bg/subtle' },
  { name: 'surface-subtle', className: 'bg-surface-subtle', value: '#F3EFE8', note: 'bg/subtle' },
  { name: 'accent', className: 'bg-accent', value: '#F3EFE8', note: 'ホバー面' },
  { name: 'brand-subtle', className: 'bg-brand-subtle', value: '#FDF3EE', note: 'bg/accent-soft' },
  { name: 'primary', className: 'bg-primary', value: '#20201E', note: 'bg/strong 主要ボタン' },
];

const LINES: Swatch[] = [
  { name: 'border', className: 'bg-border', value: '#DED8CE', note: 'border/default 装飾的な区切り' },
  { name: 'border-subtle', className: 'bg-border-subtle', value: '#E7E1D8', note: 'border/subtle' },
  { name: 'input', className: 'bg-input', value: '#8D8988', note: 'border/control 操作要素の輪郭' },
  { name: 'grid-border', className: 'bg-grid-border', value: '#E7E1D8', note: 'カレンダー罫線' },
];

const BRAND: Swatch[] = [
  { name: 'brand', className: 'bg-brand', value: '#C44B17', note: 'Default / 白文字 4.81:1' },
  { name: 'brand-strong', className: 'bg-brand-strong', value: '#B34212', note: 'Hover' },
  { name: 'brand-pressed', className: 'bg-brand-pressed', value: '#9F370E', note: 'Pressed' },
  { name: 'brand-subtle', className: 'bg-brand-subtle', value: '#FDF3EE', note: '選択中のナビ' },
];

/** Button の Role 別状態色 (Figma「03 Button」node 237:40 §02)。 */
const ACTION: Swatch[] = [
  { name: 'primary-hover', className: 'bg-primary-hover', value: '#4F4E49', note: 'Primary / Hover' },
  {
    name: 'primary-pressed',
    className: 'bg-primary-pressed',
    value: '#141413',
    note: 'Primary / Pressed',
  },
  {
    name: 'secondary-hover',
    className: 'bg-secondary-hover',
    value: '#F3EFE8',
    note: 'Secondary / Hover',
  },
  {
    name: 'secondary-pressed',
    className: 'bg-secondary-pressed',
    value: '#E7E1D8',
    note: 'Secondary / Pressed',
  },
  {
    name: 'action-disabled',
    className: 'bg-action-disabled',
    value: '#F3EFE8',
    note: 'Disabled の面 (全 Role 共通)',
  },
  {
    name: 'action-disabled-foreground',
    className: 'bg-action-disabled-foreground',
    value: '#AAA69C',
    note: 'Disabled の文字',
  },
  { name: 'ring', className: 'bg-ring', value: '#20201E', note: 'フォーカスリング 2px' },
];

const STATUS: Swatch[] = [
  { name: 'success', className: 'bg-success', value: '#2E7D4F', note: 'FIX・承認済み' },
  { name: 'success-subtle', className: 'bg-success-subtle', value: '#E8F6EC' },
  { name: 'warning', className: 'bg-warning', value: '#C88718', note: '進行中' },
  { name: 'warning-subtle', className: 'bg-warning-subtle', value: '#FFF5DE' },
  { name: 'danger', className: 'bg-danger', value: '#C73329', note: 'エラー・遅延' },
  { name: 'danger-subtle', className: 'bg-danger-subtle', value: '#FDF0EF' },
];

const CALENDAR: Swatch[] = [
  { name: 'today-bg', className: 'bg-today-bg', value: '#FFF8E3' },
  { name: 'today-marker', className: 'bg-today-marker', value: '#C44B17' },
  { name: 'weekend-bg', className: 'bg-weekend-bg', value: '#F3EFE8' },
  { name: 'holiday-bg', className: 'bg-holiday-bg', value: '#FDF0EF' },
  { name: 'holiday-foreground', className: 'bg-holiday-foreground', value: '#C73329' },
];

const TEXT_COLORS: Swatch[] = [
  { name: 'foreground', className: 'bg-foreground', value: '#20201E', note: 'text/primary' },
  { name: 'text-secondary', className: 'bg-text-secondary', value: '#4F4E49', note: 'text/secondary' },
  { name: 'text-tertiary', className: 'bg-text-tertiary', value: '#6F6B63', note: 'text/muted' },
];

/** Figma 206:259 のスケジュールカード 10 テーマ。文字色は全テーマ共通 (#22211F)。 */
const PLAN_THEMES = [
  { name: 'Warm Gray', surface: 'bg-plan-warm-gray-surface', accent: 'bg-plan-warm-gray-accent' },
  { name: 'Rose', surface: 'bg-plan-rose-surface', accent: 'bg-plan-rose-accent' },
  { name: 'Coral', surface: 'bg-plan-coral-surface', accent: 'bg-plan-coral-accent' },
  { name: 'Amber', surface: 'bg-plan-amber-surface', accent: 'bg-plan-amber-accent' },
  { name: 'Lime', surface: 'bg-plan-lime-surface', accent: 'bg-plan-lime-accent' },
  { name: 'Green', surface: 'bg-plan-green-surface', accent: 'bg-plan-green-accent' },
  { name: 'Teal', surface: 'bg-plan-teal-surface', accent: 'bg-plan-teal-accent' },
  { name: 'Cyan', surface: 'bg-plan-cyan-surface', accent: 'bg-plan-cyan-accent' },
  { name: 'Blue', surface: 'bg-plan-blue-surface', accent: 'bg-plan-blue-accent' },
  { name: 'Violet', surface: 'bg-plan-violet-surface', accent: 'bg-plan-violet-accent' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-heading-section font-bold">{title}</h3>
      {children}
    </section>
  );
}

function SwatchGrid({ items }: { items: Swatch[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {items.map((s) => (
        <li key={s.name} className="overflow-hidden rounded-lg border border-border bg-background">
          <div className={`h-14 border-b border-border ${s.className}`} />
          <div className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-body font-medium">{s.name}</span>
            <span className="text-label text-text-tertiary">{s.value}</span>
            {s.note ? <span className="text-label text-text-secondary">{s.note}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TokenCatalog() {
  return (
    <div className="flex flex-col gap-10 p-6">
      <header className="flex flex-col gap-1">
        <p className="text-label font-bold tracking-widest text-brand-strong">DESIGN TOKENS</p>
        <h2 className="font-display text-wordmark">TRAKON</h2>
        <p className="text-body text-text-secondary">
          Figma「TRAKON｜Design」/ APP DESIGN GUIDE v1.0 由来。暖色ニュートラル + ブランドオレンジ
          #C44B17。
        </p>
      </header>

      <Section title="サーフェス">
        <SwatchGrid items={SURFACES} />
      </Section>
      <Section title="罫線">
        <SwatchGrid items={LINES} />
      </Section>
      <Section title="テキスト">
        <SwatchGrid items={TEXT_COLORS} />
      </Section>
      <Section title="ブランド">
        <SwatchGrid items={BRAND} />
      </Section>
      <Section title="Button の状態色 (node 237:40)">
        <SwatchGrid items={ACTION} />
      </Section>
      <Section title="状態">
        <SwatchGrid items={STATUS} />
      </Section>
      <Section title="カレンダー日付軸">
        <SwatchGrid items={CALENDAR} />
      </Section>

      <Section title="スケジュールカード 10 テーマ (Figma 206:259)">
        <p className="text-body text-text-secondary">
          色は状態ではなく、ユーザーがスケジュールを視覚整理するために使用する。
        </p>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {PLAN_THEMES.map((t) => (
            <li
              key={t.name}
              className="overflow-hidden rounded-lg border border-border bg-background"
            >
              <div className={`flex items-start justify-between p-4 ${t.surface}`}>
                <div className="flex flex-col gap-1 text-plan-foreground">
                  <span className="text-body font-bold">Webデザイン</span>
                  <span className="text-label">7.21（火）– 7.24（金）</span>
                </div>
                <span className={`size-[18px] shrink-0 rounded-full ${t.accent}`} />
              </div>
              <div className="px-3 py-2 text-body font-medium">{t.name}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="タイポグラフィ">
        <ul className="flex flex-col gap-3">
          <li className="font-display text-wordmark">TRAKON — font-display / text-wordmark (32px)</li>
          <li className="text-heading-page font-bold">
            App/Heading/Page — text-heading-page (24px / 34px) / Bold — 画面のタイトル
          </li>
          <li className="text-heading-section font-bold">
            App/Heading/Section — text-heading-section (18px / 28px) / Bold — 領域・セクションの見出し
          </li>
          <li className="text-body">
            App/Body/Default — text-body (14px / 22px) / Regular — 本文・説明文
          </li>
          <li className="text-button font-medium">
            App/Button/Default — text-button (14px / 20px) / Medium — ボタンのラベル
          </li>
          <li className="text-label font-medium">
            App/Label/Default — text-label (12px / 18px) / Medium — 短い項目名・ラベル
          </li>
          <li className="text-label">
            App/Caption/Default — text-label (12px / 18px) / Regular — 日付・注記・補足情報
          </li>
          <li className="text-mini text-text-secondary">
            例外 — text-mini (10px) — スケジュール高密度表示専用
          </li>
          <li className="text-micro text-text-secondary">
            例外 — text-micro (9px) — スケジュール高密度表示専用
          </li>
        </ul>
      </Section>

      <Section title="角丸">
        <ul className="flex flex-wrap gap-4">
          {[
            ['rounded-sm', '6px'],
            ['rounded-md', '8px'],
            ['rounded-lg', '10px'],
            ['rounded-xl', '12px'],
            ['rounded-2xl', '14px'],
          ].map(([cls, px]) => (
            <li key={cls} className="flex flex-col items-center gap-2">
              <div className={`size-20 border border-border bg-surface-muted ${cls}`} />
              <span className="text-label text-text-secondary">
                {cls} / {px}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="影">
        <ul className="flex flex-wrap gap-6">
          {[
            ['shadow-card', 'カード'],
            ['shadow-float', 'フローティング'],
          ].map(([cls, label]) => (
            <li key={cls} className="flex flex-col items-center gap-2">
              <div className={`size-24 rounded-lg bg-background ${cls}`} />
              <span className="text-label text-text-secondary">
                {cls} / {label}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

const meta = {
  title: 'foundation/Design Tokens',
  component: TokenCatalog,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TokenCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const All: Story = {};
