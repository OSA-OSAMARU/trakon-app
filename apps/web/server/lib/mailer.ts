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

/** トライアル終了間近の通知 (§7.10 / PRD 付記) */
export type TrialWillEndEmail = {
  to: string;
  organizationName: string;
  trialEnd: Date | null;
};

/** 支払い失敗・追加認証要求の通知 */
export type PaymentFailedEmail = {
  to: string;
  organizationName: string;
  /** 猶予期限。追加認証要求のときは null */
  graceEndsAt: Date | null;
  /** 3D セキュア等の追加認証が必要なケース */
  actionRequired: boolean;
};

/** 解約完了の通知 */
export type SubscriptionCanceledEmail = {
  to: string;
  organizationName: string;
};

export type Mailer = {
  sendInvitation(input: InvitationEmail): Promise<void>;
  sendTrialWillEnd(input: TrialWillEndEmail): Promise<void>;
  sendPaymentFailed(input: PaymentFailedEmail): Promise<void>;
  sendSubscriptionCanceled(input: SubscriptionCanceledEmail): Promise<void>;
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
    async sendTrialWillEnd(input) {
      // eslint-disable-next-line no-console
      console.log(
        `[trakon][mailer/dummy] trial_will_end -> ${input.to} | org="${input.organizationName}" trialEnd=${input.trialEnd?.toISOString() ?? '-'}`,
      );
    },
    async sendPaymentFailed(input) {
      // eslint-disable-next-line no-console
      console.log(
        `[trakon][mailer/dummy] payment_failed -> ${input.to} | org="${input.organizationName}" grace=${input.graceEndsAt?.toISOString() ?? '-'} actionRequired=${input.actionRequired}`,
      );
    },
    async sendSubscriptionCanceled(input) {
      // eslint-disable-next-line no-console
      console.log(
        `[trakon][mailer/dummy] subscription_canceled -> ${input.to} | org="${input.organizationName}"`,
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

    // 課金系の通知 (§7.10)。決済情報は本文に含めない (PRD SR-BILL-05)。
    async sendTrialWillEnd(input) {
      const deadline = input.trialEnd
        ? input.trialEnd.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
        : '間もなく';
      await sendSimple(client, fromEmail, {
        to: input.to,
        subject: '無料トライアル終了のお知らせ | TRAKON',
        heading: '無料トライアルが終了します',
        lines: [
          `${escapeHtml(input.organizationName)} の無料トライアルは ${escapeHtml(deadline)} に終了します。`,
          '終了後は登録済みのお支払い方法へ自動で請求されます。',
          '継続しない場合は、終了時刻までに解約してください。',
        ],
      });
    },

    async sendPaymentFailed(input) {
      const deadline = input.graceEndsAt
        ? input.graceEndsAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
        : null;
      await sendSimple(client, fromEmail, {
        to: input.to,
        subject: input.actionRequired
          ? 'お支払いに追加の確認が必要です | TRAKON'
          : 'お支払いを確認できませんでした | TRAKON',
        heading: input.actionRequired
          ? 'お支払いに追加の確認が必要です'
          : 'お支払いを確認できませんでした',
        lines: [
          `${escapeHtml(input.organizationName)} のお支払い手続きが完了していません。`,
          ...(input.actionRequired
            ? ['カード会社の追加認証が必要です。お支払い方法の画面から手続きしてください。']
            : []),
          ...(deadline
            ? [`${escapeHtml(deadline)} までにお支払い方法を更新してください。それまでは通常どおりご利用いただけます。`]
            : []),
          '期限を過ぎると編集を停止し、閲覧のみとなります。データは削除されません。',
        ],
      });
    },

    async sendSubscriptionCanceled(input) {
      await sendSimple(client, fromEmail, {
        to: input.to,
        subject: '解約手続きが完了しました | TRAKON',
        heading: '解約手続きが完了しました',
        lines: [
          `${escapeHtml(input.organizationName)} の契約は解約されました。`,
          'ご利用いただきありがとうございました。',
          'プロジェクトやメンバーのデータは削除していません。再契約すればそのまま続きから利用できます。',
        ],
      });
    },
  };
}

/** 課金系通知の共通レンダラ。招待メールと同じ素朴な HTML/text 構成にそろえる。 */
async function sendSimple(
  client: Resend,
  fromEmail: string,
  input: { to: string; subject: string; heading: string; lines: string[] },
): Promise<void> {
  const html = `<!doctype html>
<html lang="ja"><body style="font-family:sans-serif;line-height:1.7;color:#1a1a1a">
<h1 style="font-size:18px">${escapeHtml(input.heading)}</h1>
${input.lines.map((l) => `<p>${l}</p>`).join('\n')}
<hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
<p style="font-size:12px;color:#888">TRAKON — Keep the ball moving.</p>
</body></html>`;
  const text = [input.heading, '', ...input.lines.map(stripTags), '', 'TRAKON'].join('\n');

  const { error } = await client.emails.send({
    from: fromEmail,
    to: input.to,
    subject: input.subject,
    html,
    text,
  });
  if (error) {
    throw new Error(`[trakon][mailer/resend] send failed: ${error.message ?? 'unknown'}`);
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
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
