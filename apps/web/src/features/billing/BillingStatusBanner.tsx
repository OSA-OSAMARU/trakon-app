import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useEntitlement } from './useEntitlement';

/**
 * 支払い失敗・閲覧のみ状態のグローバルバナー (設計書 §4.5.2)。
 *
 * 課金起因の制限は**隠さない**。理由と復旧導線 (CTA) を必ず添える。
 * 隠すとユーザーが復旧手段にたどり着けないため。
 */
export function BillingStatusBanner() {
  const { entitlement } = useEntitlement();
  if (!entitlement) return null;

  const needsAttention =
    entitlement.reason === 'in_grace_period' ||
    entitlement.level === 'read_only' ||
    entitlement.reason === 'incomplete';
  if (!needsAttention) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-border bg-warning-subtle px-6 py-3 text-sm"
    >
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {entitlement.message}
      </span>
      <Link
        to="/settings/billing"
        className="shrink-0 font-medium underline underline-offset-2"
      >
        お支払い方法を更新
      </Link>
    </div>
  );
}
