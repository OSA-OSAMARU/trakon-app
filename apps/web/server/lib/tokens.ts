import { createHash, randomBytes } from 'node:crypto';

/**
 * 256 bit のランダムトークン (生 / ハッシュ) を生成する。
 * - 生トークンはメール本文の URL に埋め込み、DB には保存しない
 * - ハッシュは SHA-256 (16 進文字列) で `invitations.token_hash` などに保存
 * 設計書: docs/design/05-security.md §5.5
 */
export function generateInvitationToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** 既定: 72 時間 (PRD SR-AUTH-02) */
export function defaultInvitationExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + 72 * 60 * 60 * 1000);
}
