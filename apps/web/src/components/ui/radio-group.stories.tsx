import type { Meta, StoryObj } from '@storybook/react';

import { RadioGroup, RadioGroupItem } from './radio-group';

/** Figma「06 Form Controls / Guide v1.0」node 342:90 / Form/Radio */
const meta = {
  title: 'ui/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="b">
      <RadioGroupItem value="a">選択肢 A</RadioGroupItem>
      <RadioGroupItem value="b">選択肢 B</RadioGroupItem>
      <RadioGroupItem value="c">選択肢 C</RadioGroupItem>
    </RadioGroup>
  ),
};

export const Disabled: Story = {
  render: () => (
    <RadioGroup defaultValue="b">
      <RadioGroupItem value="a" disabled>
        選択肢 A
      </RadioGroupItem>
      <RadioGroupItem value="b" disabled>
        選択肢 B
      </RadioGroupItem>
    </RadioGroup>
  ),
};
