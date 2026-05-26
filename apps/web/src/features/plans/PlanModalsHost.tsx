import { useSearchParams } from 'react-router-dom';

import type { ProjectMember } from '@/features/projects/membersApi';
import { CreatePlanModal } from './CreatePlanModal';
import { BallDetailModal } from './BallDetailModal';
import type { Plan } from './api';

/**
 * URL の `?modal=...` を見て SC-07 / SC-08 を出し分けるホスト。
 * 各モーダルは閉じる時に URL の modal 系パラメータを掃除する。
 */
export function PlanModalsHost({
  projectId,
  itemId,
  members,
  plans,
}: {
  projectId: string;
  itemId: string;
  members: ProjectMember[];
  plans: Plan[];
}) {
  const [params, setParams] = useSearchParams();
  const modal = params.get('modal');

  const closeModal = () => {
    setParams(
      (sp) => {
        for (const k of ['modal', 'date', 'fromMemberId', 'planId']) sp.delete(k);
        return sp;
      },
      { replace: true },
    );
  };

  if (modal === 'create-plan' || modal === 'edit-plan') {
    return (
      <CreatePlanModal
        projectId={projectId}
        itemId={itemId}
        members={members}
        plans={plans}
        mode={modal === 'edit-plan' ? 'edit' : 'create'}
        defaultDate={params.get('date') ?? undefined}
        defaultFromMemberId={params.get('fromMemberId') ?? undefined}
        planId={params.get('planId') ?? undefined}
        onClose={closeModal}
      />
    );
  }

  if (modal === 'ball-detail' && params.get('planId')) {
    return (
      <BallDetailModal
        projectId={projectId}
        itemId={itemId}
        planId={params.get('planId')!}
        members={members}
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
