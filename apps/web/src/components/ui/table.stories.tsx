import type { Meta, StoryObj } from '@storybook/react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table';

const meta = {
  title: 'ui/Table',
  component: Table,
  tags: ['autodocs'],
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

const members = [
  { name: '田中太郎', role: '制作側', email: 'tanaka@example.com' },
  { name: '佐藤花子', role: 'クライアント', email: 'sato@example.com' },
];

export const Default: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名前</TableHead>
          <TableHead>役割</TableHead>
          <TableHead>メールアドレス</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.email}>
            <TableCell>{member.name}</TableCell>
            <TableCell>{member.role}</TableCell>
            <TableCell>{member.email}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};
