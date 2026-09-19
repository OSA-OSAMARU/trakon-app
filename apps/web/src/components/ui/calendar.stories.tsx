import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Calendar } from './calendar';

/**
 * 月表示のカレンダー。
 * Figma「06 Form Controls / Guide v1.0」の Calendar セクション (node `342:102`)。
 */
const meta = {
  title: 'ui/Calendar',
  component: Calendar,
  parameters: { layout: 'centered' },
  args: {
    // 「今日」を固定して、いつ見ても Figma と同じ並びになるようにする
    today: new Date('2026-09-12T00:00:00'),
    value: '2026-09-08',
    onSelect: () => {},
  },
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 8 日を選択中、12 日が今日。輪郭 (今日) と塗り (選択中) を見分ける */
export const Default: Story = {};

/** 未選択。今日の輪郭だけが出る */
export const Unselected: Story = { args: { value: null } };

/** 選択できる範囲を絞った状態。範囲外は淡色で押せない */
export const WithRange: Story = {
  args: { min: '2026-09-05', max: '2026-09-20' },
};

/** 実際に選べる状態。月送りと選択の往復を確認する */
export const Interactive: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>('2026-09-08');
    return (
      <div className="flex flex-col items-center gap-3">
        <Calendar {...args} value={value} onSelect={setValue} />
        <p className="text-text-secondary text-label">選択: {value ?? '—'}</p>
      </div>
    );
  },
};
