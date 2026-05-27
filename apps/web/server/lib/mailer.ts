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
        subject: `[TRAKON] ${input.projectName} への招待`,
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
    `TRAKON のプロジェクト「${input.projectName}」への招待が届きました。`,
    '',
    `招待者: ${input.inviterName}`,
    `期限  : ${input.expiresHuman}`,
    '',
    '以下の URL からアカウント作成・招待受諾を行ってください。',
    input.acceptUrl,
    '',
    '本メールに心当たりがない場合は無視してください。',
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
  return `<!doctype html><html lang="ja"><body style="font-family:-apple-system,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;color:#0f172a;line-height:1.6">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h1 style="font-size:18px;margin:0 0 12px">TRAKON プロジェクトへの招待</h1>
    <p>「<strong>${escapeHtml(input.projectName)}</strong>」への招待が届きました。</p>
    <p style="margin:8px 0"><strong>招待者:</strong> ${escapeHtml(input.inviterName)}<br/><strong>期限:</strong> ${escapeHtml(input.expiresHuman)}</p>
    <p style="margin:24px 0">
      <a href="${input.acceptUrl}" style="display:inline-block;padding:10px 16px;background:#030213;color:#fff;border-radius:6px;text-decoration:none">招待を受諾する</a>
    </p>
    <p style="font-size:12px;color:#64748b">ボタンが動かない場合は次の URL を直接開いてください:<br/>${input.acceptUrl}</p>
    <p style="font-size:12px;color:#64748b;margin-top:32px">本メールに心当たりがない場合は無視してください。 — TRAKON</p>
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
export function __setMailerForTest(m: Mailer): void {
  cached = m;
}
