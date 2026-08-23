import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { ProjectSummary } from './api';
import { ProjectTable } from './ProjectListPage';

// デモデータは Figma node 20:2 の架空名称に揃える
const project = (over: Partial<ProjectSummary> & { id: string; name: string }): ProjectSummary => ({
  clientName: '株式会社灯和食品',
  startDate: '2026-06-29',
  endDate: '2026-08-31',
  status: 'active',
  archivedAt: null,
  role: 'director',
  createdBy: 'u1',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
  progressManager: { id: 'm1', name: '横山 直樹' },
  overdueCount: 0,
  ...over,
});

const ROWS: ProjectSummary[] = [
  project({ id: 'p1', name: 'ブランドサイト制作', overdueCount: 2 }),
  project({
    id: 'p2',
    name: '採用サイト制作',
    clientName: '青庭不動産株式会社',
    progressManager: { id: 'm2', name: '佐伯 隆志' },
  }),
  project({ id: 'p3', name: '新刊特設サイト', clientName: '合同会社ひより書房' }),
  project({
    id: 'p4',
    name: '企業サイトリニューアル',
    clientName: '株式会社澄川製作所',
    progressManager: { id: 'm3', name: '杉野 遥' },
    overdueCount: 1,
  }),
  project({ id: 'p5', name: '展示会ツール制作', clientName: '株式会社北極星精機', role: 'member' }),
  project({ id: 'p6', name: 'ECサイト改善', clientName: '木庭生活用品株式会社' }),
];

const meta: Meta<typeof ProjectTable> = {
  title: 'projects/ProjectTable',
  component: ProjectTable,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <div className="bg-content p-8">
            <div className="mx-auto max-w-[1120px]">
              <Story />
            </div>
          </div>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  ],
  args: { rows: ROWS },
};

export default meta;
type Story = StoryObj<typeof ProjectTable>;

export const Default: Story = {};
