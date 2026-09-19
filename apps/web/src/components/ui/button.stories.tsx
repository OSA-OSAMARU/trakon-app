import type { Meta, StoryObj } from '@storybook/react';
import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from './button';

/**
 * Figma「03 Button / Guide v1.0」node 237:40 (実体 469:304 / 470:304)。
 * `variant` が Figma の Role プロパティに 1:1 対応する。
 */
const meta = {
  title: 'ui/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['brand', 'primary', 'secondary', 'destructive', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['sm', 'default', 'lg', 'icon', 'icon-sm'],
    },
    loading: { control: 'boolean' },
  },
  args: { children: 'Button' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 中心操作。工程を前へ進める唯一のブランド色ボタン */
export const Brand: Story = { args: { variant: 'brand', children: '次の工程へトス' } };
/** 画面の主操作 (承認・保存・確定) */
export const Primary: Story = { args: { variant: 'primary', children: '保存' } };
/** 補助操作 (キャンセル・戻る) */
export const Secondary: Story = { args: { variant: 'secondary', children: 'キャンセル' } };

/** ガイド範囲外。削除など破壊的操作でコードベースが使う */
export const Destructive: Story = { args: { variant: 'destructive', children: '削除する' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Link: Story = { args: { variant: 'link' } };

/** 36px。Button / Small (node 469:304)。「今日」「メンバー」など副次操作 */
export const Small: Story = { args: { size: 'sm', children: '今日' } };
/** 44px。Button / Large (node 470:304)。フォーム・主要操作の標準 */
export const Large: Story = { args: { size: 'lg', children: 'プロジェクトを作成' } };

/**
 * Role × State の一覧 (ガイド §02)。Hover / Pressed は実際にマウス操作して確認する。
 * Disabled は全 Role 共通で bg #F3EFE8 / 文字 #AAA69C / 枠 #DED8CE。
 */
export const RoleAndState: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      {(['brand', 'primary', 'secondary'] as const).map((variant) => (
        <div key={variant} className="flex items-center gap-4">
          <span className="text-label text-text-secondary w-24 shrink-0">{variant}</span>
          <Button variant={variant} size="lg">
            予定を確認する
          </Button>
          <Button variant={variant} size="lg" disabled>
            予定を確認する
          </Button>
          <Button variant={variant} size="lg" loading>
            処理中
          </Button>
        </div>
      ))}
    </div>
  ),
};

/**
 * Loading は Disabled とは別扱い (ガイド §05)。Spinner を出して二重実行を防ぎ、
 * aria-busy を立てるが、配色は Default のまま変えない。
 */
export const Loading: Story = { args: { loading: true, children: '保存中…' } };

/**
 * Button 内のアイコンは 16px・ラベルとの間隔 8px・色は文字と同じ (ガイド「04 ICON」node 286:90)。
 * 「保存・確定・キャンセル」は操作名だけで意味が明確なのでアイコンを付けない。
 */
export const WithIcon: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="lg">
        <ChevronLeft />
        戻る
      </Button>
      <Button variant="secondary" size="lg">
        次へ
        <ChevronRight />
      </Button>
      <Button variant="brand" size="lg">
        <Plus />
        追加
      </Button>
      <Button variant="secondary" size="lg">
        <Pencil />
        編集
      </Button>
      <Button variant="secondary" size="lg">
        <Trash2 />
        削除
      </Button>
      <Button variant="secondary" size="lg">
        <Download />
        PDF出力
      </Button>
    </div>
  ),
};
