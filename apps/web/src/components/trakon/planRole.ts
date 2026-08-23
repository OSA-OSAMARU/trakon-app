/**
 * 予定の 3 役割の定義 (#131 / Figma node 25:2)。
 *
 * アバターの色は人ではなく**役割**に紐づく（Figma でも実施者=青 / 承認者=橙 /
 * 進行責任者=濃灰で一貫している）ため、カードを流し読みしても誰が承認者かが分かる。
 */
export const PLAN_ROLES = ['executor', 'approver', 'manager'] as const;

export type PlanRole = (typeof PLAN_ROLES)[number];

export const PLAN_ROLE_SPEC: Record<
  PlanRole,
  { label: string; avatar: string; avatarSubtle: string }
> = {
  executor: {
    label: '実施者',
    avatar: 'bg-role-executor',
    avatarSubtle: 'bg-role-executor-subtle',
  },
  approver: {
    label: '承認者',
    avatar: 'bg-role-approver',
    avatarSubtle: 'bg-role-approver-subtle',
  },
  manager: { label: '進行責任者', avatar: 'bg-role-manager', avatarSubtle: 'bg-role-manager-subtle' },
};

export function planRoleLabel(role: PlanRole): string {
  return PLAN_ROLE_SPEC[role].label;
}
