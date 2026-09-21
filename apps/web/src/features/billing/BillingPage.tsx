import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import {
  BILLING_PLANS,
  SELECTABLE_BILLING_PLAN_CODES,
  hasLiveSubscription,
  type BillingPlanCode,
} from '@trakon/shared';

import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api';
import { externalRedirect } from '@/lib/navigate';
import { projectsApi, projectsQueryKey } from '@/features/projects/api';

import {
  billingApi,
  billingQueryKey,
  type CheckoutablePlan,
  type OrganizationBilling,
} from './api';

/**
 * SC-18 プラン・お支払い (設計書 §4.4 / 章7、Figma node 263:18)。
 *
 * 状態表現の方針 (§4.5.2):
 *   - 課金起因の制限は**隠さず**、無効化 + 理由 + 復旧導線 (CTA) を出す
 *   - Checkout から戻った直後は「反映待ち」を表示し、契約状態をポーリングする。
 *     **この画面遷移だけを根拠に有料機能を有効化しない** (PRD SR-BILL-03)
 */
export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const checkoutResult = params.get('checkout');
  const checkoutSessionId = params.get('session_id');
  /**
   * 反映待ちを諦めた待機 (waitToken)。手動で取り直す導線を出すために持つ (#209)。
   * 待機の種類ごとに持つので、次の待機が始まれば自動で解ける。
   */
  const [gaveUpToken, setGaveUpToken] = useState<string | null>(null);
  /** 確認モーダルで選択中のプラン。押した瞬間に課金を動かさない (#235) */
  const [confirming, setConfirming] = useState<CheckoutablePlan | null>(null);
  /**
   * プラン一覧の開閉 (Figma node 263:18)。
   * デザインでは「現在のプラン」カードだけが見えていて、比較表は
   * 「プランを変更」を押してから出る。ただし未契約 (実効 Free) のときは
   * アップグレード導線が 1 クリック奥に隠れてしまうので最初から開いておく。
   *
   * 既定値は契約状態から決まるので、**ユーザーが操作するまでは null** にしておく
   * (#197)。以前は `plansOpen || 実効Free` で描画を決めていたため、Free のときは
   * 「プランを変更」を押しても既に開いている表が開くだけで、画面が何も変わらず
   * 「ボタンが効かない」ように見えていた。
   */
  const [plansOpenOverride, setPlansOpenOverride] = useState<boolean | null>(null);
  /** 開いた瞬間にプラン一覧まで送る。押した結果が画面外だと反応が無いのと同じため */
  const plansRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: billingQueryKey.subscription,
    queryFn: () => billingApi.get(),
  });

  const subscription = query.data?.subscription ?? null;

  /**
   * Stripe 側の反映を待っている状態。入口は 2 つある。
   *
   * 1. Checkout から戻った直後 (`?checkout=success`)。契約そのものがまだ無い。
   * 2. 即時適用のプラン変更 (Personal → Team)。追加請求の決済成功を確認するまで
   *    Team 権限を与えない設計なので、`pendingPlanCode` だけが立っている状態で
   *    Webhook (invoice.paid / subscription.updated) を待っている (#235)。
   *
   * 次回更新時に適用されるダウングレードは待機ではない (日付が決まっていて、
   * その日まで何も起きないのが正しい) ので `pendingPlanEffectiveAt` で見分ける。
   *
   * **サーバーが返した契約状態から導出する。** 変更 API の戻り値を起点にすると、
   * 画面を離れて戻ってきたときに待機が復元されず、止まったまま気づけない。
   */
  const awaitingCheckout =
    checkoutResult === 'success' && (subscription === null || subscription.status === 'none');
  const pendingImmediatePlan =
    subscription !== null &&
    subscription.pendingPlanCode !== null &&
    subscription.pendingPlanEffectiveAt === null
      ? subscription.pendingPlanCode
      : null;

  /**
   * 3. 予約ダウングレードの適用予定時刻を過ぎたのに、まだ切り替わっていない (#244)。
   *
   * Stripe 側では予定どおり切り替わっているはずなので、TRAKON が受け取り損ねた
   * ということ。これを待機に含めないと、Webhook が 1 通落ちただけで
   * 「変更予定（過去の日付）」のまま永久に固まる。取りに行けば自己修復する。
   */
  const overduePendingPlan =
    subscription !== null &&
    subscription.pendingPlanCode !== null &&
    subscription.pendingPlanEffectiveAt !== null &&
    new Date(subscription.pendingPlanEffectiveAt).getTime() <= Date.now()
      ? subscription.pendingPlanCode
      : null;

  const pendingSyncPlan = pendingImmediatePlan ?? overduePendingPlan;

  const waitToken = awaitingCheckout
    ? `checkout:${checkoutSessionId ?? '-'}`
    : pendingSyncPlan
      ? `plan:${pendingSyncPlan}`
      : null;
  const waiting = waitToken !== null && waitToken !== gaveUpToken;
  const timedOut = waitToken !== null && waitToken === gaveUpToken;

  /**
   * 待っている間は Stripe へ現在値を取りに行く (#209 / #235)。
   *
   * Webhook の到着を待つだけだと、Webhook が登録できない環境 (Preview デプロイは
   * URL がデプロイごとに変わる) や配信が遅れている間、「確認中です」のまま
   * 元のプランで止まり続ける。押し出しを待つのではなく**取りに行く**。
   *
   * 権限の根拠は画面遷移ではなく Stripe API が返す契約の現在値なので、
   * SR-BILL-03 (success URL への遷移だけを根拠にしない) は満たしている。
   */
  useQuery({
    queryKey: ['billing', 'sync', waitToken] as const,
    queryFn: async () => {
      const data = await billingApi.sync(checkoutSessionId);
      qc.setQueryData(billingQueryKey.subscription, data);
      return data;
    },
    enabled: waiting,
    refetchInterval: 3000,
    // 失敗しても「確認中」のまま黙らせない。時間切れで手動導線へ切り替える
    retry: false,
    gcTime: 0,
  });

  // 契約が確定したら Checkout の痕跡を片付けて知らせる
  useEffect(() => {
    if (checkoutResult !== 'success') return;
    if (!subscription || subscription.status === 'none') return;
    const next = new URLSearchParams(params);
    next.delete('checkout');
    next.delete('session_id');
    setParams(next, { replace: true });
    toast.success('プランが有効になりました');
  }, [checkoutResult, subscription, params, setParams]);

  // プラン変更が確定した瞬間を知らせる。待機が明けたことが画面上の唯一の合図なので、
  // 黙って表示が変わるだけだと「いつ反映されたのか」が分からない。
  const previousPendingPlan = useRef<BillingPlanCode | null>(null);
  useEffect(() => {
    if (previousPendingPlan.current !== null && pendingSyncPlan === null && subscription) {
      toast.success(`${BILLING_PLANS[subscription.planCode].label} プランへの変更が反映されました`);
    }
    previousPendingPlan.current = pendingSyncPlan;
  }, [pendingSyncPlan, subscription]);

  // 反映待ちが長引いても永遠に回さない (Stripe 側で成立していない場合の保険)。
  // 黙って止めると「確認中のまま何も起きない」に戻るので、手動の取り直し導線を出す。
  useEffect(() => {
    if (!waiting || waitToken === null) return;
    const timer = setTimeout(() => setGaveUpToken(waitToken), 30_000);
    return () => clearTimeout(timer);
  }, [waiting, waitToken]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: billingQueryKey.subscription });
    qc.invalidateQueries({ queryKey: projectsQueryKey.all });
  };

  const checkoutMut = useMutation({
    mutationFn: (planCode: CheckoutablePlan) => billingApi.checkout(planCode),
    onSuccess: (data) => externalRedirect(data.url),
    onError: (e) => {
      // 「既に契約がある」はこの画面が古いということ。二重契約はサーバーが
      // 止めてくれているので、表示だけ現在値へ戻す (#241)
      if (e instanceof ApiClientError && e.code === 'SUBSCRIPTION_ALREADY_ACTIVE') invalidate();
      toast.error(errorMessage(e, 'お申し込みを開始できませんでした'));
    },
  });

  const portalMut = useMutation({
    mutationFn: () => billingApi.portal(),
    onSuccess: (data) => externalRedirect(data.url),
    onError: (e) => toast.error(errorMessage(e, 'お支払い管理画面を開けませんでした')),
  });

  const changePlanMut = useMutation({
    mutationFn: (planCode: CheckoutablePlan) => billingApi.changePlan(planCode),
    onSuccess: (data) => {
      invalidate();
      toast.success(
        data.pendingPlanCode === 'team'
          ? 'プラン変更を受け付けました。お支払いの確認後に反映されます。'
          : '次回更新時に Personal プランへ変更されます。',
      );
    },
    onError: (e) => {
      if (
        e instanceof ApiClientError &&
        (e.code === 'PLAN_CHANGE_ALREADY_REQUESTED' || e.code === 'PLAN_UNCHANGED')
      ) {
        invalidate();
      }
      toast.error(errorMessage(e, 'プランを変更できませんでした'));
    },
  });

  /** 時間切れ後に手動で取り直す (#209)。自動ポーリングと同じ照合を 1 回だけ走らせる */
  const syncMut = useMutation({
    mutationFn: () => billingApi.sync(checkoutSessionId),
    onSuccess: (data) => {
      qc.setQueryData(billingQueryKey.subscription, data);
      qc.invalidateQueries({ queryKey: projectsQueryKey.all });
      // 取り直しても待機条件が解けていないなら、Stripe 側でまだ成立していない。
      // 「更新しました」と言い切ると、何も変わっていないのに解決した顔になる。
      // 予定時刻を過ぎた予約変更も「まだ解けていない」側 (#244)
      const stillWaiting =
        data.subscription.status === 'none' ||
        (data.subscription.pendingPlanCode !== null &&
          (data.subscription.pendingPlanEffectiveAt === null ||
            new Date(data.subscription.pendingPlanEffectiveAt).getTime() <= Date.now()));
      if (stillWaiting) {
        toast.error('Stripe 側でまだ確認できていません。お支払いが完了しているかご確認ください。');
      } else {
        setGaveUpToken(null);
        toast.success('契約状態を更新しました');
      }
    },
    onError: (e) => toast.error(errorMessage(e, '契約状態を取得できませんでした')),
  });

  const cancelMut = useMutation({
    mutationFn: () => billingApi.cancel(),
    onSuccess: () => {
      invalidate();
      toast.success('解約を受け付けました。期間終了まではご利用いただけます。');
    },
    onError: (e) => toast.error(errorMessage(e, '解約できませんでした')),
  });

  const resumeMut = useMutation({
    mutationFn: () => billingApi.resume(),
    onSuccess: () => {
      invalidate();
      toast.success('解約を取り消しました');
    },
    onError: (e) => toast.error(errorMessage(e, '解約を取り消せませんでした')),
  });

  const plansOpen =
    plansOpenOverride ?? query.data?.entitlement.effectivePlanCode === 'free';

  const togglePlans = () => {
    const next = !plansOpen;
    setPlansOpenOverride(next);
    if (next) {
      // 描画されてからスクロールする
      requestAnimationFrame(() =>
        plansRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    }
  };

  const anyPending =
    checkoutMut.isPending ||
    portalMut.isPending ||
    changePlanMut.isPending ||
    cancelMut.isPending ||
    resumeMut.isPending;

  const confirmPlanChange = (plan: CheckoutablePlan) => {
    setConfirming(null);
    if (hasLiveSubscription(subscription?.status ?? 'none')) {
      changePlanMut.mutate(plan);
    } else {
      checkoutMut.mutate(plan);
    }
  };

  return (
    <>
      <PageHeader
        width="md"
        title="プラン・お支払い"
        description="契約内容と利用状況、決済情報を管理します"
      />
      <PageContainer width="md">
        {query.isLoading && <Skeleton className="h-64 w-full rounded-md" />}
        {query.error && <p className="text-body text-destructive">契約情報の取得に失敗しました</p>}

        {query.data && (
          <div className="grid gap-6">
            {checkoutResult === 'canceled' && (
              <Notice>お申し込みは完了していません。もう一度お試しください。</Notice>
            )}

            {waiting && (
              <Notice icon={<Loader2 className="size-4 animate-spin" />}>
                {pendingImmediatePlan
                  ? `${BILLING_PLANS[pendingImmediatePlan].label} プランへの変更を確認中です。お支払いの確認後に反映されます。`
                  : overduePendingPlan
                    ? `${BILLING_PLANS[overduePendingPlan].label} プランへの切り替えを反映しています。`
                    : 'お支払いの確認中です。反映まで少しお待ちください。'}
              </Notice>
            )}

            {/* 時間切れ。黙って諦めず、取り直す手段を渡す (#209 / #235) */}
            {timedOut && (
              <Notice>
                <span className="flex flex-wrap items-center gap-2">
                  お支払いの確認に時間がかかっています。
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => syncMut.mutate()}
                    disabled={syncMut.isPending}
                  >
                    {syncMut.isPending && <Loader2 className="size-4 animate-spin" />}
                    最新の状態を取得
                  </Button>
                </span>
              </Notice>
            )}

            <CurrentPlanCard
              billing={query.data}
              onOpenPortal={() => portalMut.mutate()}
              onCancel={() => cancelMut.mutate()}
              onResume={() => resumeMut.mutate()}
              onChangePlan={togglePlans}
              plansOpen={plansOpen}
              // 反映待ちでも決済情報の管理は塞がない。支払いが通らずに待機が続いて
              // いる場合、Customer Portal を開くことがまさに復旧手段になるため。
              disabled={anyPending || awaitingCheckout}
            />

            {plansOpen && (
              <PlanComparison
                ref={plansRef}
                // 契約プランではなく**実効プラン**で「利用中」を決める。
                // 解約済みは実効 Free なので、同じプランへ申し込み直せる (§7.6)
                current={query.data.entitlement.effectivePlanCode}
                hasSubscription={hasLiveSubscription(query.data.subscription.status)}
                canManage={query.data.orgRole === 'owner' || query.data.orgRole === 'admin'}
                // 受付済みの変更をもう一度押させない (サーバーも 409 で弾く #241)
                pending={query.data.subscription.pendingPlanCode}
                // 変更が飛んでいる間に別のプランを重ねて押させない
                disabled={anyPending || waiting}
                onSelect={setConfirming}
              />
            )}

            {confirming && (
              <PlanChangeConfirmDialog
                plan={confirming}
                billing={query.data}
                onClose={() => setConfirming(null)}
                onConfirm={() => confirmPlanChange(confirming)}
              />
            )}

            {query.data.frozenProjectIds.length > 0 && (
              <RetainedProjectsCard
                organizationBillingKey={query.data.organizationId}
                frozenProjectIds={query.data.frozenProjectIds}
                projectLimit={query.data.entitlement.limits.projectLimit}
                onDone={invalidate}
                disabled={anyPending}
              />
            )}
          </div>
        )}
      </PageContainer>
    </>
  );
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiClientError ? e.message : fallback;
}

function Notice({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-4 py-3 text-body">
      {icon ?? <AlertTriangle className="size-4" />}
      <span>{children}</span>
    </div>
  );
}

/** 上限が null (無制限) のときは「無制限」と出す。 */
function limitLabel(limit: number | null): string {
  return limit === null ? '無制限' : String(limit);
}

function CurrentPlanCard({
  billing,
  onOpenPortal,
  onCancel,
  onResume,
  onChangePlan,
  plansOpen,
  disabled,
}: {
  billing: OrganizationBilling;
  onOpenPortal: () => void;
  onCancel: () => void;
  onResume: () => void;
  onChangePlan: () => void;
  /** プラン一覧が開いているか。ボタンの文言を状態に合わせるために受け取る (#197) */
  plansOpen: boolean;
  disabled: boolean;
}) {
  const { subscription, entitlement } = billing;
  // 契約プランではなく実効プランを出す。解約済み・支払い不能で契約プランを
  // 出すと「Team なのに Free の上限」という矛盾した表示になる
  const spec = BILLING_PLANS[entitlement.effectivePlanCode];
  const live = hasLiveSubscription(subscription.status);
  const canManage = billing.orgRole === 'owner' || billing.orgRole === 'admin';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-heading-section">現在のプラン</CardTitle>
        <p className="text-text-secondary mt-0.5 text-label">
          このアカウントの契約内容と利用上限を確認できます
        </p>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* 契約中のプランを 1 か所で言い切る (Figma node 263:18) */}
        <div className="bg-brand-subtle flex items-center justify-between gap-4 rounded-lg px-5 py-4">
          <div className="min-w-0">
            <p className="text-text-tertiary text-label font-medium tracking-wider uppercase">
              Current Plan
            </p>
            <p className="mt-0.5 text-heading-page font-semibold">{spec.label}</p>
            <p className="text-text-secondary mt-1 text-label">
              会員アカウント {limitLabel(spec.seatLimit)}人 / アクティブプロジェクト{' '}
              {limitLabel(spec.projectLimit)}
              {spec.monthlyPriceJpyIncTax
                ? ` / 月額 ${spec.monthlyPriceJpyIncTax.toLocaleString()} 円 (税込)`
                : ''}
            </p>
          </div>
          <Badge variant={entitlement.effectivePlanCode === 'free' ? 'secondary' : 'brand'}>
            利用中
          </Badge>
        </div>

        <div>
          <h3 className="text-body font-semibold">利用状況</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <UsageTile
              label="会員アカウント枠"
              value={`${entitlement.usage.seatCount} / ${limitLabel(entitlement.limits.seatLimit)} アカウント`}
            />
            <UsageTile
              label="所有プロジェクト"
              value={
                entitlement.limits.projectLimit === null
                  ? '無制限'
                  : `${entitlement.usage.projectCount} / ${entitlement.limits.projectLimit} 件`
              }
            />
          </div>
          <p className="text-text-tertiary mt-2 text-label">
            招待されて参加しているプロジェクトは、所有プロジェクト数に含まれません。
          </p>
        </div>

        <p className="text-muted-foreground text-body">{entitlement.message}</p>

        {/* 契約の細目。Figma には無いが、無いと解約予定や変更予定に気づけない */}
        <dl className="grid gap-2 text-body sm:grid-cols-2">
          {/* 終了した契約の日付は残っているだけなので出さない (解約後に
              「次回更新」が出ると更新されるように読めてしまう) */}
          {live && subscription.trialEnd && (
            <Row label="トライアル終了">{formatDateTime(subscription.trialEnd)}</Row>
          )}
          {live && subscription.currentPeriodEnd && (
            <Row label={subscription.cancelAtPeriodEnd ? '利用可能期限' : '次回更新'}>
              {formatDateTime(subscription.currentPeriodEnd)}
            </Row>
          )}
          {subscription.pendingPlanCode && (
            <Row label="変更予定">
              {BILLING_PLANS[subscription.pendingPlanCode].label}
              {subscription.pendingPlanEffectiveAt
                ? `（${formatDateTime(subscription.pendingPlanEffectiveAt)}）`
                : '（お支払いの確認後）'}
            </Row>
          )}
          {subscription.paymentMethod?.last4 && (
            <Row label="お支払い方法">
              {subscription.paymentMethod.brand ?? 'カード'} •••• {subscription.paymentMethod.last4}
            </Row>
          )}
        </dl>

        {/* 課金起因の制限は隠さず、理由と復旧導線を出す (§4.5.2) */}
        {entitlement.graceEndsAt && (
          <Notice>
            {formatDateTime(entitlement.graceEndsAt)} までにお支払い方法を更新してください。
          </Notice>
        )}

        <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          {live &&
            (subscription.cancelAtPeriodEnd ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onResume}
                disabled={disabled || !canManage}
                className="mr-auto"
              >
                解約を取り消す
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={disabled || !canManage}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive mr-auto"
              >
                解約する
              </Button>
            ))}
          {subscription.hasStripeCustomer && (
            <Button variant="secondary" onClick={onOpenPortal} disabled={disabled || !canManage}>
              決済情報を管理
            </Button>
          )}
          {/* プラン一覧の開閉は画面内の表示切り替えでしかないので、決済処理中でも
              権限が無くても押せる (#197)。実際の申し込み・変更は一覧の中の
              ボタンが担い、そちらで無効化と理由の提示を行う。 */}
          <Button onClick={onChangePlan} aria-expanded={plansOpen}>
            {plansOpen ? 'プラン一覧を閉じる' : 'プランを変更'}
          </Button>
        </div>

        {!canManage && (
          <p className="text-muted-foreground text-label">
            プランの変更・解約は組織のオーナーまたは管理者のみが行えます。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function UsageTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-accent rounded-lg px-4 py-3">
      <p className="text-text-secondary text-label">{label}</p>
      <p className="mt-1 text-heading-section font-semibold">{value}</p>
    </div>
  );
}

const PlanComparison = forwardRef<
  HTMLDivElement,
  {
    current: BillingPlanCode;
    hasSubscription: boolean;
    canManage: boolean;
    disabled: boolean;
    /** 受付済みで反映待ちのプラン。同じプランをもう一度押させない (#241) */
    pending: BillingPlanCode | null;
    onSelect: (plan: CheckoutablePlan) => void;
  }
>(function PlanComparison({ current, hasSubscription, canManage, disabled, pending, onSelect }, ref) {
  return (
    <Card ref={ref}>
      <CardHeader>
        <CardTitle className="text-heading-section">プランを選ぶ</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        {SELECTABLE_BILLING_PLAN_CODES.map((code) => {
          const spec = BILLING_PLANS[code];
          const isCurrent = code === current;
          const isPending = code === pending;
          return (
            <div
              key={code}
              className="flex flex-col gap-3 rounded-lg border border-border p-4"
              data-testid={`plan-${code}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{spec.label}</span>
                {isCurrent ? (
                  <Badge variant="secondary">
                    <Check className="size-3" />
                    利用中
                  </Badge>
                ) : (
                  isPending && <Badge variant="outline">変更を受付済み</Badge>
                )}
              </div>
              <p className="text-heading-page font-semibold">
                {spec.monthlyPriceJpyIncTax?.toLocaleString() ?? '—'}
                <span className="ml-1 text-label font-normal text-muted-foreground">
                  円 / 月(税込)
                </span>
              </p>
              <ul className="grid gap-1 text-label text-muted-foreground">
                <li>会員アカウント {spec.seatLimit ?? '無制限'} 名</li>
                <li>プロジェクト {spec.projectLimit ?? '無制限'} 件</li>
                <li>
                  {spec.trialHours ? `無料トライアル ${spec.trialHours} 時間` : 'トライアルなし'}
                </li>
              </ul>
              {code !== 'free' && !isCurrent && !isPending && (
                <Button
                  size="sm"
                  onClick={() => onSelect(code as CheckoutablePlan)}
                  disabled={disabled || !canManage}
                >
                  {hasSubscription ? 'このプランに変更' : '申し込む'}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
});

/**
 * プラン申し込み・変更の確認 (#235)。
 *
 * 押した瞬間に課金が動く操作なので、**何がいつ起きるか**を出してから確定させる。
 * 3 つの経路で結果がまるで違うため、同じ文面にまとめない。
 *   申し込み       … Stripe の決済ページへ離脱する
 *   Personal → Team … 即時適用。残期間の差額を日割りで追加請求する (§7.7.1)
 *   Team → Personal … 次回更新時に適用。返金は無く、上限が下がる (§7.7.2)
 */
function PlanChangeConfirmDialog({
  plan,
  billing,
  onClose,
  onConfirm,
}: {
  plan: CheckoutablePlan;
  billing: OrganizationBilling;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const spec = BILLING_PLANS[plan];
  const live = hasLiveSubscription(billing.subscription.status);
  const kind: 'subscribe' | 'upgrade' | 'downgrade' = !live
    ? 'subscribe'
    : plan === 'team'
      ? 'upgrade'
      : 'downgrade';

  const price = `${spec.monthlyPriceJpyIncTax?.toLocaleString() ?? '—'} 円 / 月 (税込)`;
  const periodEnd = billing.subscription.currentPeriodEnd;

  const notes: string[] =
    kind === 'subscribe'
      ? [
          `月額 ${price}。`,
          spec.trialHours
            ? `初回は ${spec.trialHours} 時間の無料トライアルが付きます (カードの登録は必要です)。`
            : 'トライアルはありません。',
          '「進む」を押すと Stripe の決済ページへ移動します。',
        ]
      : kind === 'upgrade'
        ? [
            `月額 ${price} になります。`,
            '現在の請求期間の残り日数分の差額を、日割りで追加請求します。返金はありません。',
            'Team の上限が使えるようになるのは、この追加請求のお支払いが確認できた後です。',
          ]
        : [
            `月額 ${price} になります。`,
            periodEnd
              ? `切り替わるのは次回更新日 (${formatDateTime(periodEnd)}) です。それまでは現在のプランのままご利用いただけます。`
              : '切り替わるのは次回更新日です。それまでは現在のプランのままご利用いただけます。',
            '日割りの返金はありません。',
            `変更後の上限は会員アカウント ${limitLabel(spec.seatLimit)} 人 / アクティブプロジェクト ${limitLabel(spec.projectLimit)} 件です。現在これを超えている場合は変更できません。`,
          ];

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {kind === 'subscribe'
              ? `${spec.label} プランに申し込みますか？`
              : `${spec.label} プランに変更しますか？`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <ul className="grid list-disc gap-1 pl-4 text-left">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={onConfirm}>
            {kind === 'subscribe' ? '決済ページへ進む' : '変更する'}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 上限超過時に維持するプロジェクトを選び直す (FR-BILL-11)。
 * 超過分は削除されず凍結されているだけなので、選び直せば元に戻る。
 */
function RetainedProjectsCard({
  frozenProjectIds,
  projectLimit,
  onDone,
  disabled,
}: {
  organizationBillingKey: string;
  frozenProjectIds: string[];
  projectLimit: number | null;
  onDone: () => void;
  disabled: boolean;
}) {
  const projectsQuery = useQuery({
    queryKey: projectsQueryKey.all,
    queryFn: () => projectsApi.list(),
  });
  const [selected, setSelected] = useState<string[] | null>(null);

  const mutation = useMutation({
    mutationFn: (projectIds: string[]) => billingApi.setRetainedProjects(projectIds),
    onSuccess: () => {
      onDone();
      toast.success('維持するプロジェクトを更新しました');
    },
    onError: (e) => toast.error(errorMessage(e, '更新できませんでした')),
  });

  const projects = projectsQuery.data ?? [];
  const active = projects.filter((p) => p.archivedAt === null);
  const current =
    selected ?? active.filter((p) => !frozenProjectIds.includes(p.id)).map((p) => p.id);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const base = prev ?? current;
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-heading-section">維持するプロジェクトを選ぶ</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-body text-muted-foreground">
          プランの上限を超えているため、{frozenProjectIds.length} 件のプロジェクトが閲覧のみに
          なっています。データは削除されていません。
          {projectLimit !== null && ` 維持できるのは ${projectLimit} 件までです。`}
        </p>

        <ul className="grid gap-2">
          {active.map((p) => {
            const checked = current.includes(p.id);
            return (
              <li key={p.id} className="flex items-center gap-2 text-body">
                <input
                  type="checkbox"
                  id={`retain-${p.id}`}
                  checked={checked}
                  onChange={() => toggle(p.id)}
                  disabled={disabled || mutation.isPending}
                />
                <label htmlFor={`retain-${p.id}`} className="flex items-center gap-2">
                  {p.name}
                  {frozenProjectIds.includes(p.id) && <Badge variant="secondary">閲覧のみ</Badge>}
                </label>
              </li>
            );
          })}
        </ul>

        <div>
          <Button
            size="sm"
            onClick={() => mutation.mutate(current)}
            disabled={
              disabled ||
              mutation.isPending ||
              (projectLimit !== null && current.length > projectLimit)
            }
          >
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            この構成で維持する
          </Button>
          {projectLimit !== null && current.length > projectLimit && (
            <p className="mt-1 text-label text-destructive">
              選べるのは {projectLimit} 件までです（現在 {current.length} 件）。
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    return format(parseISO(iso), 'yyyy/MM/dd HH:mm');
  } catch {
    return iso;
  }
}
