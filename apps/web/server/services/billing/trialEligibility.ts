// -----------------------------------------------------------------------------
// トライアル重複判定 — 設計書 §7.9.2
//
// 【確定要件】法人カードの共有による誤判定があり得るため、カードの識別子のみを
// 根拠に自動拒否してはならない。本設計ではそもそも識別子を保存しない。
//
// ハード拒否 : user_id / 正規化メール / organization_id / 過去の顧客 ID
// 記録のみ   : メールドメイン (拒否には使わない)
//
// 誤判定時の解除は運用手順 (docs/operations.md) で DB を直接更新する。
// -----------------------------------------------------------------------------
import { prisma } from '@trakon/db';

export type TrialEligibility = {
  eligible: boolean;
  /** 拒否理由。eligible なら null */
  reason: 'user' | 'email' | 'organization' | 'customer' | null;
};

/**
 * メールアドレスを正規化する。
 * 大小文字とドット・+タグの揺れを吸収し、同一人物の再取得を防ぐ。
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const [local, domain] = trimmed.split('@');
  if (!local || !domain) return trimmed;
  const withoutTag = local.split('+')[0] ?? local;
  // Gmail 系はドットを無視する
  const normalizedLocal =
    domain === 'gmail.com' || domain === 'googlemail.com'
      ? withoutTag.replaceAll('.', '')
      : withoutTag;
  return `${normalizedLocal}@${domain}`;
}

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split('@')[1] ?? '';
}

/** トライアルを付与してよいかを判定する。 */
export async function checkTrialEligibility(input: {
  userId: string;
  organizationId: string;
  email: string;
  stripeCustomerId: string | null;
}): Promise<TrialEligibility> {
  const normalized = normalizeEmail(input.email);

  const claim = await prisma.billingTrialClaim.findFirst({
    where: {
      releasedAt: null,
      OR: [
        { userId: input.userId },
        { emailNormalized: normalized },
        { organizationId: input.organizationId },
        ...(input.stripeCustomerId ? [{ stripeCustomerId: input.stripeCustomerId }] : []),
      ],
    },
    select: { userId: true, emailNormalized: true, organizationId: true, stripeCustomerId: true },
  });

  if (!claim) return { eligible: true, reason: null };

  const reason: TrialEligibility['reason'] =
    claim.userId === input.userId
      ? 'user'
      : claim.emailNormalized === normalized
        ? 'email'
        : claim.organizationId === input.organizationId
          ? 'organization'
          : 'customer';

  return { eligible: false, reason };
}
