import { Hono } from 'hono';

import { prisma } from '@trakon/db';

import { getMailer } from '../../lib/mailer.js';
import {
  applyEvent,
  isStaleInvoiceEvent,
  isSupportedEvent,
  prefetchSubscription,
  type BillingNotification,
} from '../../services/billing/webhookHandlers.js';
import { getStripe, getWebhookSecret } from '../../services/billing/stripeClient.js';

/**
 * Stripe Webhook — 設計書 §3.2.4c / §7.5
 *
 * TRAKON の 3 層認可 (認証 → プロジェクト参加 → ロール) に当てはまらない唯一の例外。
 * 認可は **Webhook 署名の検証**によって行う。
 *
 * 【重要】このルートでは c.req.json() を絶対に呼ばない。
 * 署名検証には JSON パース前の生ボディが要る。api/index.ts が Hono の Web ハンドラを
 * 名前付き HTTP メソッド export として公開しているため、Vercel が生成した
 * Web 標準 Request がそのまま渡り、c.req.text() で無改変のボディが取れる。
 */
export const stripeWebhookRoute = new Hono().post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: { code: 'STRIPE_SIGNATURE_MISSING', message: 'Missing signature.' } }, 400);
  }

  // 1) 署名検証 (生ボディを使う)
  const raw = await c.req.text();
  let event;
  try {
    event = await getStripe().webhooks.constructEventAsync(raw, signature, getWebhookSecret());
  } catch (err) {
    // Stripe は 4xx では再送しない。検証を通らないリクエストの内容は一切信用しない。
    console.warn('[stripe] signature verification failed:', err);
    return c.json(
      { error: { code: 'STRIPE_SIGNATURE_INVALID', message: 'Invalid signature.' } },
      400,
    );
  }

  if (!isSupportedEvent(event.type)) {
    return c.json({ data: { received: true, ignored: true } });
  }

  // 2) 冪等性: イベント ID の一意制約で二重処理を防ぐ。
  //    既に受信済みなら副作用を起こさずに 200 を返す。
  const ledger = await prisma.stripeEvent.createMany({
    data: {
      stripeEventId: event.id,
      eventType: event.type,
      eventCreatedAt: new Date(event.created * 1000),
      payload: {},
    },
    skipDuplicates: true,
  });
  if (ledger.count === 0) {
    return c.json({ data: { received: true, duplicate: true } });
  }

  // 3) 契約系は受信ペイロードを信じず現在値を取り直す (順序逆転対策)。
  //    外部 API 呼び出しはトランザクションの外で行う (接続を占有しないため)。
  const snapshot = await prefetchSubscription(event);

  let notification: BillingNotification | undefined;
  try {
    notification = await prisma.$transaction(
      async (tx) => {
        // 4) 請求書系のみ、最終反映より古いイベントをスキップ扱いにする
        const target = snapshot
          ? await tx.billingSubscription.findUnique({
              where: { organizationId: snapshot.organizationId },
              select: { lastStripeEventAt: true },
            })
          : null;
        if (target && isStaleInvoiceEvent(event, target.lastStripeEventAt)) {
          await tx.stripeEvent.update({
            where: { stripeEventId: event.id },
            data: { status: 'skipped', processedAt: new Date() },
          });
          return undefined;
        }

        // 5) DB へ反映 + 監査ログ + 台帳の処理済み記録を 1 トランザクションで
        const outcome = await applyEvent(tx, event, { snapshot });
        await tx.stripeEvent.update({
          where: { stripeEventId: event.id },
          data: {
            status: outcome.status,
            processedAt: new Date(),
            organizationId: outcome.organizationId,
          },
        });
        return outcome.notification;
      },
      // 既定 5 秒では足りないことがある (§7.5.4)
      { timeout: 10_000 },
    );
  } catch (err) {
    console.error('[stripe] failed to apply webhook event:', err);
    await prisma.stripeEvent
      .update({
        where: { stripeEventId: event.id },
        data: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
      })
      .catch(() => undefined);
    // 500 を返して Stripe に再送させる。冪等なので安全。
    return c.json({ error: { code: 'WEBHOOK_APPLY_FAILED', message: 'Failed to apply.' } }, 500);
  }

  // 6) コミット後に通知を 1 通だけ送る。
  //    メール失敗で 500 を返すと Stripe が再送し続けて無限ループになるため握りつぶす。
  if (notification) {
    try {
      await sendNotification(notification);
    } catch (err) {
      console.error('[stripe] notification failed (ignored):', err);
    }
  }

  return c.json({ data: { received: true } });
});

async function sendNotification(notification: BillingNotification): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: notification.organizationId },
    select: { name: true, owner: { select: { email: true, displayName: true } } },
  });
  if (!org?.owner?.email) return;

  const mailer = getMailer();
  const to = org.owner.email;
  const organizationName = org.name;

  switch (notification.type) {
    case 'trial_will_end':
      await mailer.sendTrialWillEnd({ to, organizationName, trialEnd: notification.trialEnd });
      return;
    case 'payment_failed':
    case 'payment_action_required':
      await mailer.sendPaymentFailed({
        to,
        organizationName,
        graceEndsAt: notification.type === 'payment_failed' ? notification.graceEndsAt : null,
        actionRequired: notification.type === 'payment_action_required',
      });
      return;
    case 'subscription_canceled':
      await mailer.sendSubscriptionCanceled({ to, organizationName });
      return;
  }
}
