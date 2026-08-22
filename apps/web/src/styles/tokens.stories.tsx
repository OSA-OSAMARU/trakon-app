import type { Meta, StoryObj } from '@storybook/react';

/* =============================================================================
 * デザイントークンのカタログ (globals.css の内容と 1:1 で対応)
 * 実装の見た目確認と、Figma との突き合わせに使う。
 * ============================================================================= */

type Swatch = { name: string; className: string; value: string; note?: string };

const SURFACES: Swatch[] = [
  { name: 'background', className: 'bg-background', value: '#FFFFFF', note: 'カード・ヘッダー帯' },
  { name: 'content', className: 'bg-content', value: '#F7F6F2', note: 'アプリ本体の背景' },
  { name: 'sidebar', className: 'bg-sidebar', value: '#FCFBF8' },
  { name: 'surface-muted', className: 'bg-surface-muted', value: '#F7F5F1', note: '週末行' },
  { name: 'surface-subtle', className: 'bg-surface-subtle', value: '#F9F8F5' },
  { name: 'muted', className: 'bg-muted', value: '#F9F8F5' },
  { name: 'secondary', className: 'bg-secondary', value: '#F7F5F1' },
  { name: 'accent', className: 'bg-accent', value: '#F2EFE9', note: 'ホバー面' },
  { name: 'primary', className: 'bg-primary', value: '#23231F', note: '主要ボタン' },
];

const LINES: Swatch[] = [
  { name: 'border', className: 'bg-border', value: '#E6E2DB' },
  { name: 'input', className: 'bg-input', value: '#DED8CE', note: '入力・ボタン輪郭' },
  { name: 'grid-border', className: 'bg-grid-border', value: '#E8E5DF', note: 'カレンダー罫線' },
];

const BRAND: Swatch[] = [
  { name: 'brand', className: 'bg-brand', value: '#E7672C' },
  { name: 'brand-strong', className: 'bg-brand-strong', value: '#E05224' },
  { name: 'brand-subtle', className: 'bg-brand-subtle', value: '#F8EFE8', note: '選択中のナビ' },
  { name: 'brand-badge', className: 'bg-brand-badge', value: '#FCE8DB', note: 'PRO バッジ' },
];

const STATUS: Swatch[] = [
  { name: 'success', className: 'bg-success', value: '#2E7D4F', note: 'FIX・承認済み' },
  { name: 'success-subtle', className: 'bg-success-subtle', value: '#E8F6EC' },
  { name: 'warning', className: 'bg-warning', value: '#C88718', note: '進行中' },
  { name: 'warning-subtle', className: 'bg-warning-subtle', value: '#FFF5DE' },
  { name: 'danger', className: 'bg-danger', value: '#B14E41', note: '遅延・祝日' },
  { name: 'danger-subtle', className: 'bg-danger-subtle', value: '#FEF7F5' },
];

const CALENDAR: Swatch[] = [
  { name: 'today-bg', className: 'bg-today-bg', value: '#FFF8E3' },
  { name: 'today-marker', className: 'bg-today-marker', value: '#E7672C' },
  { name: 'weekend-bg', className: 'bg-weekend-bg', value: '#F7F5F1' },
  { name: 'holiday-bg', className: 'bg-holiday-bg', value: '#FEF7F5' },
  { name: 'holiday-foreground', className: 'bg-holiday-foreground', value: '#B14E41' },
];

const TEXT_COLORS: Swatch[] = [
  { name: 'foreground', className: 'bg-foreground', value: '#23231F' },
  { name: 'text-secondary', className: 'bg-text-secondary', value: '#676862' },
  { name: 'text-tertiary', className: 'bg-text-tertiary', value: '#908F87' },
];

/** Figma 54:2 のスケジュールカード 10 テーマ。文字色は全テーマ共通 (#22211F)。 */
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
      <h3 className="text-base font-bold">{title}</h3>
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
            <span className="text-mini text-text-tertiary">{s.value}</span>
            {s.note ? <span className="text-mini text-text-secondary">{s.note}</span> : null}
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
        <p className="text-mini font-bold tracking-widest text-brand-strong">DESIGN TOKENS</p>
        <h2 className="font-display text-wordmark">TRAKON</h2>
        <p className="text-body text-text-secondary">
          Figma「TRAKON｜Landing Page」由来。暖色ニュートラル + ブランドオレンジ #E7672C。
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
      <Section title="状態">
        <SwatchGrid items={STATUS} />
      </Section>
      <Section title="カレンダー日付軸">
        <SwatchGrid items={CALENDAR} />
      </Section>

      <Section title="スケジュールカード 10 テーマ (Figma 54:2)">
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
                  <span className="text-sm font-bold">Webデザイン</span>
                  <span className="text-mini">7.21（火）– 7.24（金）</span>
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
          <li className="text-title font-bold">画面タイトル — text-title (22px) / Bold</li>
          <li className="text-xl font-bold">セクション・月見出し — text-xl (20px) / Bold</li>
          <li className="text-base font-bold">カード見出し — text-base (16px) / Bold</li>
          <li className="text-sm">本文 — text-sm (14px) / Regular</li>
          <li className="text-body">本文（密） — text-body (13px) / Regular</li>
          <li className="text-xs">キャプション — text-xs (12px)</li>
          <li className="text-tiny">日付軸・補助 — text-tiny (11px)</li>
          <li className="text-mini">高密度カレンダー — text-mini (10px)</li>
          <li className="text-micro">ロールラベル — text-micro (9px)</li>
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
              <span className="text-mini text-text-secondary">
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
              <span className="text-mini text-text-secondary">
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
