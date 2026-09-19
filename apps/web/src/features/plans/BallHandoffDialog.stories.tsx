import type { Meta, StoryObj } from '@storybook/react';

import { BallHandoffDialog } from './BallHandoffDialog';

/**
 * ボールを受け渡すときのダイアログ (#206)。
 * Figma「Schedule / Confirmation TOSS Modal」(node `45:26`) と
 * 「Schedule / Comment RETURN Modal」(node `45:8`)。
 */
const meta = {
  title: 'plans/BallHandoffDialog',
  component: BallHandoffDialog,
  parameters: { layout: 'centered' },
  args: {
    open: true,
    pending: false,
    planTitle: 'Webデザイン',
    contextLabel: '灯和食品｜ブランドサイト',
    handoffLabel: '杉野 遥 → 石原 美咲',
    onClose: () => {},
    onSubmit: () => {},
  },
} satisfies Meta<typeof BallHandoffDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 確認TOSS。実施者 → 承認者。メッセージは任意 */
export const ConfirmationToss: Story = {
  args: { kind: 'review-request' },
};

/** コメントRETURN。承認者 → 実施者。**戻す理由は必須** */
export const CommentReturn: Story = {
  args: { kind: 'comment-return', handoffLabel: '石原 美咲 → 杉野 遥' },
};

/** 次の工程へトス。進行責任者 → 後続予定の実施者。申し送りは任意 */
export const NextToss: Story = {
  args: { kind: 'toss', handoffLabel: '横山 直樹 → 青木 蓮' },
};

/** 相手が未設定なら「誰から誰へ」を出さない */
export const WithoutRecipient: Story = {
  args: { kind: 'review-request', handoffLabel: null },
};
