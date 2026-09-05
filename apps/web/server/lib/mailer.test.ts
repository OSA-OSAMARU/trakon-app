import { afterEach, describe, expect, it, vi } from 'vitest';

import type { getMailer as GetMailerType } from './mailer.js';

// =============================================================================
// Mocks
// =============================================================================
// Resend SDK と env.js を差し替える。getMailer() / getServerEnv() は
// いずれもモジュールレベルの singleton をキャッシュするため、各テストで
// vi.resetModules() してから動的 import し、キャッシュを分離する。

const sendMock = vi.fn(
  async (): Promise<{
    data: { id: string } | null;
    error: { message?: string } | null;
  }> => ({ data: { id: 'msg-1' }, error: null }),
);
const resendCtor = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
    constructor(...args: unknown[]) {
      resendCtor(...args);
    }
  },
}));

// env はテストごとに上書きできるよう mutable オブジェクトを返す。
const envState: Record<string, unknown> = {};
vi.mock('./env.js', () => ({
  getServerEnv: () => envState,
}));

const setEnv = (patch: Record<string, unknown>) => {
  for (const k of Object.keys(envState)) delete envState[k];
  Object.assign(envState, patch);
};

const importMailer = async (): Promise<{ getMailer: typeof GetMailerType }> => {
  vi.resetModules();
  return import('./mailer.js');
};

const invitation = {
  to: 'invitee@example.com',
  projectName: 'プロジェクト<X>',
  inviterName: '招待者 & 太郎',
  acceptUrl: 'https://app.example.com/invitations/abc',
  expiresAt: new Date('2026-07-01T12:00:00Z'),
};

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// dummy mailer (env 未設定)
// =============================================================================
describe('getMailer (dummy)', () => {
  it('APP_ENV=local かつ Resend 未設定なら dummy mailer を返し console.log で出力する', async () => {
    setEnv({ APP_ENV: 'local' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { getMailer } = await importMailer();

    const mailer = getMailer();
    await mailer.sendInvitation(invitation);

    // Resend は構築されない
    expect(resendCtor).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    // dummy はログ出力する
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toContain('[trakon][mailer/dummy] invitation');
    expect(logSpy.mock.calls[0]?.[0]).toContain(invitation.to);
    logSpy.mockRestore();
  });

  it('API_KEY のみ (FROM 未設定) なら dummy にフォールバックする', async () => {
    setEnv({ APP_ENV: 'local', RESEND_API_KEY: 'key-only' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { getMailer } = await importMailer();

    await getMailer().sendInvitation(invitation);

    expect(resendCtor).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });

  it('同一モジュール内では mailer を singleton としてキャッシュする', async () => {
    setEnv({ APP_ENV: 'local' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { getMailer } = await importMailer();

    expect(getMailer()).toBe(getMailer());
  });
});

// =============================================================================
// resend mailer (prod / dev で両キー設定)
// =============================================================================
describe('getMailer (resend)', () => {
  it('dev/local でも両キーが揃えば Resend で本送信し、正しい payload を渡す', async () => {
    setEnv({
      APP_ENV: 'dev',
      RESEND_API_KEY: 'sk-test-123',
      RESEND_FROM_EMAIL: 'noreply@trakon.test',
    });
    const { getMailer } = await importMailer();

    await getMailer().sendInvitation(invitation);

    expect(resendCtor).toHaveBeenCalledWith('sk-test-123');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = (sendMock.mock.calls[0] as unknown[])?.[0] as {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(payload.from).toBe('noreply@trakon.test');
    expect(payload.to).toBe(invitation.to);
    expect(payload.subject).toBe('「プロジェクト<X>」への参加のご案内 | TRAKON');
    // HTML 本文には受諾 URL とエスケープ済みのプロジェクト名が含まれる
    expect(payload.html).toContain(invitation.acceptUrl);
    expect(payload.html).toContain('プロジェクト&lt;X&gt;');
    expect(payload.html).toContain('招待者 &amp; 太郎');
    // text 本文にも URL と招待者名が含まれる
    expect(payload.text).toContain(invitation.acceptUrl);
    expect(payload.text).toContain('招待者 & 太郎');
  });

  it('APP_ENV=prod かつ両キー設定で Resend を使う', async () => {
    setEnv({
      APP_ENV: 'prod',
      RESEND_API_KEY: 'sk-prod',
      RESEND_FROM_EMAIL: 'noreply@trakon.app',
    });
    const { getMailer } = await importMailer();

    await getMailer().sendInvitation(invitation);

    expect(resendCtor).toHaveBeenCalledWith('sk-prod');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('APP_ENV=prod でキー欠落なら getMailer が throw する', async () => {
    setEnv({ APP_ENV: 'prod' });
    const { getMailer } = await importMailer();

    expect(() => getMailer()).toThrow(/RESEND_API_KEY and RESEND_FROM_EMAIL are required/);
  });

  it('Resend が error を返したら送信は reject する', async () => {
    setEnv({
      APP_ENV: 'dev',
      RESEND_API_KEY: 'sk-test',
      RESEND_FROM_EMAIL: 'noreply@trakon.test',
    });
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'rejected by provider' } });
    const { getMailer } = await importMailer();

    await expect(getMailer().sendInvitation(invitation)).rejects.toThrow(
      /send failed: rejected by provider/,
    );
  });

  it('Resend error に message が無い場合は unknown と表示する', async () => {
    setEnv({
      APP_ENV: 'dev',
      RESEND_API_KEY: 'sk-test',
      RESEND_FROM_EMAIL: 'noreply@trakon.test',
    });
    sendMock.mockResolvedValueOnce({ data: null, error: {} });
    const { getMailer } = await importMailer();

    await expect(getMailer().sendInvitation(invitation)).rejects.toThrow(/send failed: unknown/);
  });
});

// =============================================================================
// __setMailerForTest
// =============================================================================
describe('__setMailerForTest', () => {
  it('差し込んだ mailer のメソッドが getMailer から呼ばれる', async () => {
    setEnv({ APP_ENV: 'local' });
    const { getMailer } = await importMailer();
    const { __setMailerForTest } = await import('./mailer.js');

    // Partial で受けて残りは dummy で埋めるため、同一参照ではなく挙動で検証する
    const sendInvitation = vi.fn(async () => {});
    __setMailerForTest({ sendInvitation });

    await getMailer().sendInvitation({
      to: 'x@example.test',
      projectName: 'P',
      inviterName: 'I',
      acceptUrl: 'https://example.test/invitations/tok',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(sendInvitation).toHaveBeenCalledTimes(1);
  });
});
