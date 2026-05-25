/**
 * Mailer インターフェース。Sub-Phase 0.6 で Resend 本実装に差し替える。
 * 詳細: docs/design/06-infrastructure.md §6.5
 */

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

/**
 * Sub-Phase 0.2: 開発用ダミー実装。
 * - dev / test: console.log で送信内容を出力するのみ
 * - prod: 例外を投げて事故を防ぐ
 * Sub-Phase 0.6 で Resend を本実装する際に `createResendMailer()` を追加し、
 * APP_ENV に応じてファクトリで切り替える。
 */
export function createDummyMailer(): Mailer {
  return {
    async sendInvitation(input) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          '[trakon] Dummy mailer is not allowed in production. Wire up Resend in Sub-Phase 0.6.',
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        `[trakon][mailer/dummy] invitation -> ${input.to} | project="${input.projectName}" inviter="${input.inviterName}" url=${input.acceptUrl} expires=${input.expiresAt.toISOString()}`,
      );
    },
  };
}

let cached: Mailer | undefined;
export function getMailer(): Mailer {
  if (!cached) cached = createDummyMailer();
  return cached;
}

/** テスト用: モック差し込みポイント */
export function __setMailerForTest(m: Mailer): void {
  cached = m;
}
