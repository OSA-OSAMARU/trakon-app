// -----------------------------------------------------------------------------
// 契約状態の照合 (reconcile) — 設計書 §7.5 の補完 / #209
//
// Webhook は「Stripe → TRAKON」の押し出し経路で、これが正であることは変わらない。
// ただし押し出しは**届かないことがある**:
//   - Preview デプロイは URL がデプロイごとに変わるため、Webhook を登録できない
//   - 本番でもエンドポイント未登録・一時的な配信失敗・署名シークレットのずれが起きる
// このとき契約は Stripe 側で成立しているのに TRAKON 側は Free のままになり、
// 「カードを登録したのにプランが変わらない」状態が永続する (#209)。
//
// そこで TRAKON 側から Stripe API へ現在値を**取りに行く**経路を用意する。
//
// 【SR-BILL-03 との関係】
//   「success URL への遷移だけを根拠に有料権限を付与してはならない」という要件は
//   満たしている。ここで権限の根拠にするのは遷移ではなく **Stripe API から取得した
//   Subscription の現在値**であり、Webhook が取り直しているものと同一の情報源。
//   遷移は「いま照合する価値がある」という合図として使うだけ。
// -----------------------------------------------------------------------------
import type Stripe from 'stripe';

import { prisma } from '@trakon/db';

import { getStripe } from './stripeClient.js';
import { buildSubscriptionSnapshot, writeSubscriptionSnapshot } from './webhookHandlers.js';

export type ReconcileResult = {
  /** 契約状態を更新したか */
  synced: boolean;
  /** 更新しなかった理由 (ログ・テスト用)。synced=true のときは undefined */
  reason?: 'no_billing_row' | 'session_mismatch' | 'no_subscription' | 'stripe_error';
};

/**
 * 組織の契約状態を Stripe の現在値へ合わせる。
 *
 * @param checkoutSessionId Checkout から戻った直後なら、その Session ID。
 *   まだ `stripe_subscription_id` を持っていない組織でも契約を辿れる。
 */
export async function reconcileSubscription(input: {
  organizationId: string;
  checkoutSessionId?: string | null;
}): Promise<ReconcileResult> {
  const current = await prisma.billingSubscription.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (!current) return { synced: false, reason: 'no_billing_row' };

  const stripe = getStripe();

  let subscriptionId = current.stripeSubscriptionId;
  let customerId = current.stripeCustomerId;

  // 1) Checkout Session から辿る。Webhook が一度も届いていない場合はこれだけが手がかり。
  if (input.checkoutSessionId) {
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(input.checkoutSessionId);
    } catch (err) {
      console.warn('[stripe] checkout session retrieve failed:', err);
      return { synced: false, reason: 'stripe_error' };
    }

    // **別組織の Session ID を渡して契約を横取りされないようにする。**
    // metadata は createCheckoutSession が必ず入れている。
    if (session.metadata?.organization_id !== input.organizationId) {
      return { synced: false, reason: 'session_mismatch' };
    }

    if (typeof session.subscription === 'string') subscriptionId = session.subscription;
    if (typeof session.customer === 'string') customerId = session.customer;
  }

  // 2) それでも契約 ID が分からなければ、顧客から最新の契約を引く。
  if (!subscriptionId && customerId) {
    try {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 1,
      });
      subscriptionId = list.data[0]?.id ?? null;
    } catch (err) {
      console.warn('[stripe] subscription list failed:', err);
      return { synced: false, reason: 'stripe_error' };
    }
  }

  // 顧客 ID だけでも分かったなら保存しておく (次回の手がかりになる)
  if (!subscriptionId) {
    if (customerId && customerId !== current.stripeCustomerId) {
      await prisma.billingSubscription.update({
        where: { organizationId: input.organizationId },
        data: { stripeCustomerId: customerId },
      });
    }
    return { synced: false, reason: 'no_subscription' };
  }

  // 3) 契約の現在値を取り直す。Webhook と同じ情報源・同じ写し取り方をする。
  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method'],
    });
  } catch (err) {
    console.warn('[stripe] subscription retrieve failed:', err);
    return { synced: false, reason: 'stripe_error' };
  }

  const snapshot = buildSubscriptionSnapshot(subscription, input.organizationId, 'reconcile');

  // 4) 反映。Webhook と同じ更新規則を通す。
  //    lastStripeEvent* は**触らない**。あれは「どこまで Webhook を処理したか」の
  //    記録であり、照合でずらすと請求書系イベントの順序判定 (isStaleInvoiceEvent) が狂う。
  await prisma.$transaction(async (tx) => {
    const { planCode } = await writeSubscriptionSnapshot(tx, snapshot, {
      deleted: false,
      current,
    });

    // 監査ログは**状態が動いたときだけ**。照合は画面からポーリングで呼ばれるため
    // (反映待ちの間は数秒おき)、毎回書くと「何も変わっていない」記録で監査ログが
    // 埋まり、本当に変わった瞬間が読み取れなくなる (#235)。
    const changed =
      planCode !== current.planCode ||
      snapshot.status !== current.status ||
      snapshot.stripeSubscriptionId !== current.stripeSubscriptionId;
    if (!changed) return;

    await tx.auditLog.create({
      data: {
        actorUserId: null,
        action: 'subscription_reconciled',
        resourceType: 'subscription',
        resourceId: input.organizationId,
        result: 'success',
        extra: {
          source: 'reconcile',
          from: { planCode: current.planCode, status: current.status },
          status: snapshot.status,
          planCode,
          subscriptionId: snapshot.stripeSubscriptionId,
          ...(input.checkoutSessionId ? { checkoutSessionId: input.checkoutSessionId } : {}),
        },
      },
    });
  });

  return { synced: true };
}
