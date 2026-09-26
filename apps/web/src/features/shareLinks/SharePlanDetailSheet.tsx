import { format } from 'date-fns';
import { Eye } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CATEGORY_STYLE } from '@/features/plans/planTheme';
import type { MemberRef, Plan, PlanState } from '@/features/plans/api';

const STATE_LABEL: Record<PlanState, string> = {
  in_progress: '実施中',
  review_pending: '確認待ち',
  approved: '承認済み・TOSS待ち',
  tossed: 'TOSS済み',
  sent_back: '差し戻し',
  completed: '完了',
};

/**
 * 共有リンク (非会員) 向けの予定詳細パネル — **閲覧専用** (#257)。
 *
 * #131 ではここから確認依頼 / 承認 / 差し戻しができたが、全プランで
 * 「共有リンクで訪れた人は閲覧のみ」という方針になったため操作を外した。
 * 承認や差し戻しをしてほしい相手は、閲覧者として組織へ招待する
 * (Free でも 5 名まで招待できる)。誰が操作したかが記録に残る点でも、
 * 匿名の共有リンクより招待の方が適している。
 *
 * **メールアドレス・職種はここに出さない。** 共有リンクは誰でも開けるため、
 * 予定 DTO に載っている情報 (氏名・所属名) だけを表示する。
 */
export function SharePlanDetailSheet({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const style = CATEGORY_STYLE[plan.category];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Badge variant="secondary" className={`${style.bg} ${style.text}`}>
              {style.label}
            </Badge>
            {plan.title}
          </SheetTitle>
          <SheetDescription>
            {format(new Date(plan.scheduledDate), 'yyyy/M/d')}
            {plan.dueDate && ` 〜 期日 ${format(new Date(plan.dueDate), 'yyyy/M/d')}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-6 text-body">
          <div className="border-border bg-muted/40 flex items-center gap-2 rounded-md border p-2 text-label">
            <span className="text-muted-foreground">現在のホルダー</span>
            <span className="font-medium">{plan.ballHolder?.name ?? '—'}</span>
            <Badge variant="secondary" className="ml-auto">
              {plan.status === 'completed' ? STATE_LABEL.completed : STATE_LABEL[plan.ballState]}
            </Badge>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">実施者</dt>
            <dd>{memberLabel(plan.executor)}</dd>
            <dt className="text-muted-foreground">承認者</dt>
            <dd>{plan.approver ? memberLabel(plan.approver) : '未設定 (実施者が承認)'}</dd>
            <dt className="text-muted-foreground">進行責任者</dt>
            <dd>{memberLabel(plan.progressManager)}</dd>
          </dl>

          {plan.memo && (
            <div className="border-border bg-muted/40 rounded-md border p-3 text-label whitespace-pre-wrap">
              {plan.memo}
            </div>
          )}

          <p className="text-muted-foreground flex items-start gap-1.5 text-label">
            <Eye className="mt-0.5 size-3.5 shrink-0" />
            この共有リンクは閲覧専用です。承認や差し戻しが必要な場合は、発行元にお問い合わせください。
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function memberLabel(m: MemberRef | null): string {
  return m ? `${m.name} (${m.organizationName || '—'})` : '—';
}
