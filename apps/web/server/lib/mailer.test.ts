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

// =============================================================================
// 課金系の通知 (§7.10)
// =============================================================================
describe('課金系の通知メール', () => {
  const billingEnv = {
    APP_ENV: 'prod',
    RESEND_API_KEY: 'sk-test-123',
    RESEND_FROM_EMAIL: 'noreply@trakon.test',
  };

  const lastPayload = () =>
    (sendMock.mock.calls.at(-1) as unknown[])?.[0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };

  it('トライアル終了予告は終了時刻と自動請求を伝える', async () => {
    setEnv(billingEnv);
    const { getMailer } = await importMailer();

    await getMailer().sendTrialWillEnd({
      to: 'owner@example.test',
      organizationName: '株式会社テスト',
      trialEnd: new Date('2026-09-06T00:00:00Z'),
    });

    const payload = lastPayload();
    expect(payload.to).toBe('owner@example.test');
    expect(payload.subject).toContain('無料トライアル終了');
    expect(payload.html).toContain('株式会社テスト');
    expect(payload.text).toContain('自動で請求');
  });

  it('トライアル終了時刻が不明でも送れる', async () => {
    setEnv(billingEnv);
    const { getMailer } = await importMailer();

    await getMailer().sendTrialWillEnd({
      to: 'owner@example.test',
      organizationName: 'テスト組織',
      trialEnd: null,
    });

    expect(lastPayload().text).toContain('間もなく');
  });

  it('支払い失敗は猶予期限と「データは削除されない」ことを伝える', async () => {
    setEnv(billingEnv);
    const { getMailer } = await importMailer();

    await getMailer().sendPaymentFailed({
      to: 'owner@example.test',
      organizationName: 'テスト組織',
      graceEndsAt: new Date('2026-09-08T00:00:00Z'),
      actionRequired: false,
    });

    const payload = lastPayload();
    expect(payload.subject).toContain('お支払いを確認できませんでした');
    expect(payload.text).toContain('までにお支払い方法を更新');
    expect(payload.text).toContain('データは削除されません');
  });

  it('追加認証が必要な場合は件名と本文を切り替える', async () => {
    setEnv(billingEnv);
    const { getMailer } = await importMailer();

    await getMailer().sendPaymentFailed({
      to: 'owner@example.test',
      organizationName: 'テスト組織',
      graceEndsAt: null,
      actionRequired: true,
    });

    const payload = lastPayload();
    expect(payload.subject).toContain('追加の確認が必要');
    expect(payload.text).toContain('カード会社の追加認証');
  });

  it('解約完了はデータを消していないことを伝える', async () => {
    setEnv(billingEnv);
    const { getMailer } = await importMailer();

    await getMailer().sendSubscriptionCanceled({
      to: 'owner@example.test',
      organizationName: 'テスト組織',
    });

    const payload = lastPayload();
    expect(payload.subject).toContain('解約手続きが完了');
    expect(payload.text).toContain('削除していません');
  });

  it('決済情報 (カード番号・Stripe の ID) を本文に含めない (SR-BILL-05)', async () => {
    setEnv(billingEnv);
    const { getMailer } = await importMailer();

    await getMailer().sendPaymentFailed({
      to: 'owner@example.test',
      organizationName: 'テスト組織',
      graceEndsAt: new Date('2026-09-08T00:00:00Z'),
      actionRequired: false,
    });

    const payload = lastPayload();
    expect(payload.html).not.toMatch(/cus_|sub_|in_|price_|pi_/);
  });

  it('送信に失敗したら例外にする (呼び出し元が警告に変換する)', async () => {
    setEnv(billingEnv);
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } });
    const { getMailer } = await importMailer();

    await expect(
      getMailer().sendSubscriptionCanceled({ to: 'x@example.test', organizationName: 'o' }),
    ).rejects.toThrow(/rate limited/);
  });

  it('env 未設定なら課金系も dummy として出力する', async () => {
    setEnv({ APP_ENV: 'local' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { getMailer } = await importMailer();
    const mailer = getMailer();

    await mailer.sendTrialWillEnd({ to: 'a@example.test', organizationName: 'o', trialEnd: null });
    await mailer.sendPaymentFailed({
      to: 'a@example.test',
      organizationName: 'o',
      graceEndsAt: null,
      actionRequired: false,
    });
    await mailer.sendSubscriptionCanceled({ to: 'a@example.test', organizationName: 'o' });

    expect(sendMock).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('trial_will_end'),
      expect.stringContaining('payment_failed'),
      expect.stringContaining('subscription_canceled'),
    ]);
    logSpy.mockRestore();
  });
});
