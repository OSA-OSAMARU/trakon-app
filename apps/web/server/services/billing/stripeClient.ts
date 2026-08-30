// -----------------------------------------------------------------------------
// Stripe クライアント — 設計書 §7.3.3
//
// getMailer() と同じ遅延シングルトン + テスト差し込み口の形にそろえる。
// env は毎回読み直す (getServerEnv() のキャッシュはあるが、こちらでは持たない)。
// 未設定時は 503 を投げ、Stripe を使わない環境でもアプリ全体は起動できるようにする。
// -----------------------------------------------------------------------------
import Stripe from 'stripe';

import { getServerEnv } from '../../lib/env.js';
import { ApiException } from '../../lib/errors.js';

let cached: Stripe | undefined;

export function getStripe(): Stripe {
  if (cached) return cached;
  const env = getServerEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new ApiException(
      'BILLING_NOT_CONFIGURED',
      503,
      'Stripe is not configured in this environment.',
    );
  }
  cached = new Stripe(env.STRIPE_SECRET_KEY);
  return cached;
}

/** Webhook 署名検証に使う Secret。未設定なら 503。 */
export function getWebhookSecret(): string {
  const secret = getServerEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new ApiException(
      'BILLING_NOT_CONFIGURED',
      503,
      'Stripe webhook secret is not configured.',
    );
  }
  return secret;
}

/** テスト用の差し込み口。実 Stripe には CI から一切接続しない。 */
export function __setStripeForTest(client: Stripe | undefined): void {
  cached = client;
}
