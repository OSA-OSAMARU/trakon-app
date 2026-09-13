import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MemberProfileCard, MemberProfileHover } from './MemberProfileCard';
import type { ProjectMember } from './membersApi';

beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const member = (over: Partial<ProjectMember> = {}): ProjectMember => ({
  id: 'm1',
  userId: 'u1',
  name: '佐藤 航',
  email: 'sato@example.jp',
  organizationName: 'おさまるカンパニー',
  memberType: 'production',
  jobTitle: 'director',
  avatarUrl: null,
  roleType: 'editor',
  sortOrder: 0,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

describe('MemberProfileCard', () => {
  it('名前 / 所属名 / メールアドレス / 職種を出す (#159)', () => {
    render(<MemberProfileCard member={member()} />);
    expect(screen.getByText('佐藤 航')).toBeInTheDocument();
    expect(screen.getByText('おさまるカンパニー')).toBeInTheDocument();
    expect(screen.getByText('sato@example.jp')).toBeInTheDocument();
    expect(screen.getByText(/ディレクター/)).toBeInTheDocument();
    // 区分もあわせて出す (制作チーム / クライアント / 外部パートナー)
    expect(screen.getByText(/制作チーム/)).toBeInTheDocument();
  });

  it('未設定の項目はプレースホルダを出す', () => {
    render(
      <MemberProfileCard
        member={member({ organizationName: '', email: null, jobTitle: null })}
      />,
    );
    expect(screen.getByText('所属未設定')).toBeInTheDocument();
    expect(screen.getByText('メール未登録')).toBeInTheDocument();
    expect(screen.getByText(/職種未設定/)).toBeInTheDocument();
  });
});

describe('MemberProfileHover', () => {
  it('member が無ければ子をそのまま返す (共有リンク画面で漏らさないため)', () => {
    render(
      <MemberProfileHover member={null}>
        <span>佐藤</span>
      </MemberProfileHover>,
    );
    expect(screen.getByText('佐藤')).toBeInTheDocument();
    // トリガーを包まないので tabIndex も付かない
    expect(document.querySelector('[tabindex]')).toBeNull();
  });

  it('ホバーでプロフィールを出す', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <MemberProfileHover member={member()}>
        <span>佐藤</span>
      </MemberProfileHover>,
    );

    await user.hover(screen.getByText('佐藤'));
    expect(await screen.findByText('sato@example.jp')).toBeInTheDocument();
  });

  it('既定ではタブ順に入らない (密なボード上で移動を妨げないため)', () => {
    render(
      <MemberProfileHover member={member()}>
        <span>佐藤</span>
      </MemberProfileHover>,
    );
    expect(document.querySelector('[tabindex="-1"]')).not.toBeNull();
  });

  it('focusable を渡すとタブ順に入る (サイドモーダル用)', () => {
    render(
      <MemberProfileHover member={member()} focusable>
        <span>佐藤</span>
      </MemberProfileHover>,
    );
    expect(document.querySelector('[tabindex="0"]')).not.toBeNull();
  });
});
