import type { Meta, StoryObj } from '@storybook/react';

import { PLAN_ROLES } from './planRole';
import { RoleRow } from './RoleRow';

const meta = {
  title: 'trakon/RoleRow',
  component: RoleRow,
  tags: ['autodocs'],
  argTypes: {
    role: { control: 'select', options: [...PLAN_ROLES] },
  },
  args: { role: 'executor', name: '杉野 遥' },
} satisfies Meta<typeof RoleRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Executor: Story = {};
export const Approver: Story = { args: { role: 'approver', name: '石原 美咲' } };
export const Manager: Story = { args: { role: 'manager', name: '横山 直樹' } };

/** スケジュールカード内の役割ブロック (Figma node 25:2) */
export const CardBlock: Story = {
  render: () => (
    <div className="bg-plan-cyan-surface text-plan-foreground flex w-[240px] flex-col gap-1 rounded-lg p-4">
      <RoleRow role="executor" name="杉野 遥" />
      <RoleRow role="approver" name="石原 美咲" />
      <RoleRow role="manager" name="横山 直樹" />
    </div>
  ),
};

/** サイドモーダルの担当欄 (Figma node 38:12)。淡いタイルのアバターに職種を添える */
export const Detail: Story = {
  render: () => (
    <div className="bg-background flex w-[432px] flex-col gap-2 rounded-xl border border-border p-4">
      <RoleRow variant="detail" role="executor" name="杉野 遥" caption="デザイナー" />
      <RoleRow variant="detail" role="approver" name="石原 美咲" caption="クライアント" />
      <RoleRow variant="detail" role="manager" name="横山 直樹" caption="ディレクター" />
    </div>
  ),
};
