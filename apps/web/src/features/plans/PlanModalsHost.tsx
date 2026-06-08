import { useSearchParams } from 'react-router-dom';

import type { ProjectMember } from '@/features/projects/membersApi';
import { CreatePlanModal } from './CreatePlanModal';
import { BallDetailModal } from './BallDetailModal';
import type { Plan } from './api';

/**
 * URL の `?modal=...` を見て SC-07 / SC-08 を出し分けるホスト。
 *
 * 制作物列スケジュールでは plans が複数 item を跨ぐため、対象 itemId を解決する:
 *  - create-plan: クエリ `itemId` (列 = 制作物)。無ければ fallbackItemId。
 *  - edit-plan / ball-detail: 対象 plan の itemId。
 */
export function PlanModalsHost({
  projectId,
  members,
  plans,
  fallbackItemId,
}: {
  projectId: string;
  members: ProjectMember[];
  plans: Plan[];
  fallbackItemId: string;
}) {
  const [params, setParams] = useSearchParams();
  const modal = params.get('modal');
  const planId = params.get('planId') ?? undefined;

  const closeModal = () => {
    setParams(
      (sp) => {
        for (const k of ['modal', 'date', 'due', 'fromMemberId', 'itemId', 'planId']) sp.delete(k);
        return sp;
      },
      { replace: true },
    );
  };

  const planItemId = planId ? plans.find((p) => p.id === planId)?.itemId : undefined;

  if (modal === 'create-plan' || modal === 'edit-plan') {
    const itemId =
      modal === 'edit-plan'
        ? (planItemId ?? fallbackItemId)
        : (params.get('itemId') ?? fallbackItemId);
    return (
      <CreatePlanModal
        projectId={projectId}
        itemId={itemId}
        members={members}
        plans={plans}
        mode={modal === 'edit-plan' ? 'edit' : 'create'}
        defaultDate={params.get('date') ?? undefined}
        defaultDueDate={params.get('due') ?? undefined}
        defaultFromMemberId={params.get('fromMemberId') ?? undefined}
        planId={planId}
        onClose={closeModal}
      />
    );
  }

  if (modal === 'ball-detail' && planId) {
    return (
      <BallDetailModal
        projectId={projectId}
        itemId={planItemId ?? fallbackItemId}
        planId={planId}
        members={members}
        plans={plans}
        onClose={closeModal}
        onEdit={() => {
          setParams(
            (sp) => {
              sp.set('modal', 'edit-plan');
              return sp;
            },
            { replace: true },
          );
        }}
      />
    );
  }

  return null;
}
