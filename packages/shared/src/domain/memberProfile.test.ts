import { describe, expect, it } from 'vitest';

import {
  effectiveNotificationEmail,
  resolveMemberProfile,
  type MemberProfileSource,
  type UserProfileSource,
} from './memberProfile.js';

const member = (over: Partial<MemberProfileSource> = {}): MemberProfileSource => ({
  name: '山田 太郎',
  organizationName: '',
  jobTitle: null,
  email: null,
  ...over,
});

const user = (over: Partial<UserProfileSource> = {}): UserProfileSource => ({
  displayName: 'みやまる',
  organizationName: 'おさまるカンパニー',
  jobTitle: 'director',
  notificationEmail: null,
  email: 'yamada@example.test',
  avatarPath: 'u1/abc.webp',
  ...over,
});

describe('effectiveNotificationEmail', () => {
  it('通知先メール未設定ならログイン用メールを使う', () => {
    expect(effectiveNotificationEmail({ notificationEmail: null, email: 'a@example.test' })).toBe(
      'a@example.test',
    );
  });

  it('通知先メールがあればそちらを使う', () => {
    expect(
      effectiveNotificationEmail({ notificationEmail: 'n@example.test', email: 'a@example.test' }),
    ).toBe('n@example.test');
  });

  it('空白だけの通知先メールはログイン用メールへフォールバックする', () => {
    expect(effectiveNotificationEmail({ notificationEmail: '   ', email: 'a@example.test' })).toBe(
      'a@example.test',
    );
  });
});

describe('resolveMemberProfile', () => {
  it('アカウント紐付け済みなら users の表示名・所属名・職種・メール・アイコンを使う', () => {
    const r = resolveMemberProfile({ member: member(), user: user() });
    expect(r).toEqual({
      name: 'みやまる',
      organizationName: 'おさまるカンパニー',
      jobTitle: 'director',
      email: 'yamada@example.test',
      avatarPath: 'u1/abc.webp',
    });
  });

  it('参加者行の氏名より users.display_name が優先される (#254)', () => {
    const r = resolveMemberProfile({
      member: member({ name: '宮丸' }),
      user: user({ displayName: 'みやまる' }),
    });
    expect(r.name).toBe('みやまる');
  });

  it('表示名が空白だけなら参加者行の氏名へフォールバックする', () => {
    const r = resolveMemberProfile({
      member: member({ name: '宮丸' }),
      user: user({ displayName: '   ' }),
    });
    expect(r.name).toBe('宮丸');
  });

  it('参加者行に所属名・職種があればそちらが優先される (プロジェクト別の上書き)', () => {
    const r = resolveMemberProfile({
      member: member({ organizationName: '博報堂', jobTitle: 'designer' }),
      user: user(),
    });
    expect(r.organizationName).toBe('博報堂');
    expect(r.jobTitle).toBe('designer');
  });

  it('アカウント未紐付け (表示専用メンバー) は参加者行の値をそのまま使う', () => {
    const r = resolveMemberProfile({
      member: member({
        organizationName: '青庭不動産',
        jobTitle: 'marketer',
        email: 'guest@example.test',
      }),
      user: null,
    });
    expect(r).toEqual({
      name: '山田 太郎',
      organizationName: '青庭不動産',
      jobTitle: 'marketer',
      email: 'guest@example.test',
      avatarPath: null,
    });
  });

  it('どちらにも所属名が無ければ空文字になる', () => {
    const r = resolveMemberProfile({
      member: member(),
      user: user({ organizationName: null }),
    });
    expect(r.organizationName).toBe('');
  });

  it('通知先メールが設定されていればそちらを表示に使う', () => {
    const r = resolveMemberProfile({
      member: member({ email: 'old@example.test' }),
      user: user({ notificationEmail: 'notify@example.test' }),
    });
    expect(r.email).toBe('notify@example.test');
  });
});
