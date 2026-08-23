import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ProjectCreatePage } from './ProjectCreatePage';

/**
 * SC-04 新規プロジェクト作成 (Figma node 73:57)。
 * 送信以外はデータ取得を持たないため、そのまま描画して確認できる。
 */
const meta: Meta<typeof ProjectCreatePage> = {
  title: 'projects/ProjectCreatePage',
  component: ProjectCreatePage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/projects/new']}>
          <div className="bg-content h-[900px]">
            <Story />
          </div>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ProjectCreatePage>;

export const Default: Story = {};
