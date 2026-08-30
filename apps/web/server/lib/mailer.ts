/**
 * Mailer インターフェース。
 * - dev / test: console.log で出力する dummy mailer
 * - prod: Resend SDK で本送信 (RESEND_API_KEY / RESEND_FROM_EMAIL 必須)
 * 詳細: docs/design/06-infrastructure.md §6.5 / docs/operations.md
 */

import { Resend } from 'resend';

import { getServerEnv } from './env.js';

export type InvitationEmail = {
  to: string;
  projectName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: Date;
};

export type Mailer = {
  sendInvitation(input: InvitationEmail): Promise<void>;
};

// -----------------------------------------------------------------------------
// dummy mailer (dev / test)
// -----------------------------------------------------------------------------
function createDummyMailer(): Mailer {
  return {
    async sendInvitation(input) {
      // eslint-disable-next-line no-console
      console.log(
        `[trakon][mailer/dummy] invitation -> ${input.to} | project="${input.projectName}" inviter="${input.inviterName}" url=${input.acceptUrl} expires=${input.expiresAt.toISOString()}`,
      );
    },
  };
}

// -----------------------------------------------------------------------------
// resend mailer (prod)
// -----------------------------------------------------------------------------
function createResendMailer(apiKey: string, fromEmail: string): Mailer {
  const client = new Resend(apiKey);

  return {
    async sendInvitation(input) {
      const expires = input.expiresAt.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      const html = renderInvitationHtml({
        projectName: input.projectName,
        inviterName: input.inviterName,
        acceptUrl: input.acceptUrl,
        expiresHuman: expires,
      });
      const text = renderInvitationText({
        projectName: input.projectName,
        inviterName: input.inviterName,
        acceptUrl: input.acceptUrl,
        expiresHuman: expires,
      });
      const { error } = await client.emails.send({
        from: fromEmail,
        to: input.to,
        subject: `「${input.projectName}」への参加のご案内 | TRAKON`,
        html,
        text,
      });
      if (error) {
        throw new Error(
          `[trakon][mailer/resend] send failed: ${error.message ?? 'unknown'}`,
        );
      }
    },
  };
}

function renderInvitationText(input: {
  projectName: string;
  inviterName: string;
  acceptUrl: string;
  expiresHuman: string;
}): string {
  return [
    `${input.inviterName} さんが、TRAKON のプロジェクト「${input.projectName}」にあなたを招待しました。`,
    '',
    'TRAKON は、いま誰が次の対応を持っているか（ボール）を可視化し、制作の進行をスムーズにするツールです。',
    '',
    '▼ 参加する（アカウント作成・招待の受諾）',
    input.acceptUrl,
    '',
    `このリンクの有効期限は ${input.expiresHuman} です。`,
    '期限を過ぎた場合は、お手数ですが招待した方にご連絡ください。',
    '',
    'お心当たりがない場合は、このメールを破棄していただいて問題ありません。',
    '— TRAKON',
  ].join('\n');
}

function renderInvitationHtml(input: {
  projectName: string;
  inviterName: string;
  acceptUrl: string;
  expiresHuman: string;
}): string {
  // シンプルな HTML テンプレート。Phase 1 で React Email に移行候補
  // 認証メール（Supabase Email Templates）と同一トーン: docs/email-templates.md
  return `<!doctype html><html lang="ja"><body style="font-family:-apple-system,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;color:#0f172a;line-height:1.7;background:#f8fafc;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
    <p style="font-size:13px;letter-spacing:.08em;color:#64748b;margin:0 0 16px">TRAKON</p>
    <h1 style="font-size:18px;margin:0 0 16px">「${escapeHtml(input.projectName)}」への参加のご案内</h1>
    <p style="margin:0 0 12px"><strong>${escapeHtml(input.inviterName)}</strong> さんが、あなたをプロジェクトに招待しました。</p>
    <p style="margin:0 0 24px;color:#475569;font-size:14px">TRAKON は、いま誰が次の対応を持っているか（ボール）を可視化し、制作の進行をスムーズにするツールです。</p>
    <p style="margin:0 0 24px">
      <a href="${input.acceptUrl}" style="display:inline-block;padding:12px 20px;background:#030213;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">参加する</a>
    </p>
    <p style="font-size:13px;color:#64748b;margin:0 0 4px">このリンクの有効期限は <strong>${escapeHtml(input.expiresHuman)}</strong> です。</p>
    <p style="font-size:13px;color:#64748b;margin:0 0 24px">期限を過ぎた場合は、お手数ですが招待した方にご連絡ください。</p>
    <p style="font-size:12px;color:#94a3b8;margin:0 0 8px">ボタンが開けない場合は、次の URL をブラウザに貼り付けてください:<br/>${input.acceptUrl}</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
    <p style="font-size:12px;color:#94a3b8;margin:0">お心当たりがない場合は、このメールを破棄していただいて問題ありません。<br/>— TRAKON</p>
  </div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// -----------------------------------------------------------------------------
// factory
// -----------------------------------------------------------------------------
let cached: Mailer | undefined;

export function getMailer(): Mailer {
  if (cached) return cached;
  const env = getServerEnv();
  if (env.APP_ENV === 'prod') {
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      throw new Error(
        '[trakon] RESEND_API_KEY and RESEND_FROM_EMAIL are required when APP_ENV=prod.',
      );
    }
    cached = createResendMailer(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);
  } else if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) {
    // dev/local でも実送信を検証したい場合は両方セットで本送信に切替
    cached = createResendMailer(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);
  } else {
    cached = createDummyMailer();
  }
  return cached;
}

/** テスト用: モック差し込みポイント */
/**
 * テスト用の差し込み口。Mailer の一部メソッドだけを渡せるよう Partial を受け、
 * 残りは dummy で埋める (メソッド追加のたびに既存テストが壊れないようにするため)。
 */
export function __setMailerForTest(m: Partial<Mailer>): void {
  cached = { ...createDummyMailer(), ...m };
}
