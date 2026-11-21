import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';

import { AI_GUIDES, fillUrl } from './aiGuides';
import { AiSetupGuidePage } from './AiSetupGuidePage';

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

const URL_ = `${window.location.origin}/api/mcp`;

describe('AiSetupGuidePage (SC-22)', () => {
  it('ログインなしで、接続先 URL とサービス別の手順を示す', () => {
    renderWithProviders(<AiSetupGuidePage />, { route: '/help/ai' });

    expect(screen.getByRole('heading', { name: 'AI 連携の設定方法' })).toBeInTheDocument();
    expect(screen.getAllByText(URL_).length).toBeGreaterThan(1);

    const nav = screen.getByRole('navigation', { name: 'AI サービス別の手順' });
    for (const g of AI_GUIDES) {
      expect(within(nav).getByRole('link', { name: g.name })).toHaveAttribute('href', `#${g.id}`);
      // 各サービスの節があり、公式ドキュメントへのリンクは別タブで開く
      const section = document.getElementById(g.id)!;
      expect(section).toHaveTextContent(g.availability);
      const docs = within(section).getByRole('link', { name: new RegExp(g.docs.label) });
      expect(docs).toHaveAttribute('href', g.docs.url);
      expect(docs).toHaveAttribute('target', '_blank');
      expect(docs).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
    // {{URL}} の置き換え漏れがない
    expect(document.body.textContent).not.toContain('{{URL}}');
  });

  it('コマンドや設定例を URL を埋めた状態でコピーできる', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderWithProviders(<AiSetupGuidePage />, { route: '/help/ai' });

    await user.click(screen.getByRole('button', { name: 'Claude Codeの手順 1をコピー' }));
    expect(writeText).toHaveBeenCalledWith(`claude mcp add --transport http trakon ${URL_}`);

    await user.click(screen.getByRole('button', { name: '接続先 URL をコピー' }));
    expect(writeText).toHaveBeenLastCalledWith(URL_);
    expect(toastSuccess).toHaveBeenCalledWith('コピーしました');
  });

  it('コピーに失敗したら知らせる', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    renderWithProviders(<AiSetupGuidePage />, { route: '/help/ai' });
    await user.click(
      screen.getByRole('button', { name: 'GitHub Copilot（VS Code）の設定例をコピー' }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('コピーに失敗しました'));
  });

  it('#アンカー付きで開くとその節へ移動する', () => {
    const scroll = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scroll;
    renderWithProviders(<AiSetupGuidePage />, { route: '/help/ai#chatgpt' });
    expect(scroll).toHaveBeenCalled();
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('chatgpt'));
  });
});

describe('fillUrl', () => {
  it('すべての {{URL}} を置き換える', () => {
    expect(fillUrl('a {{URL}} b {{URL}}', 'https://x/api/mcp')).toBe(
      'a https://x/api/mcp b https://x/api/mcp',
    );
  });
});
