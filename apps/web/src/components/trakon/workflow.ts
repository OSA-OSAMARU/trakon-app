/**
 * ボール操作の定義 (Figma node 42:4 / 43:10)。
 *
 * Figma の注記どおり **TOSS / RETURN は大文字で統一し、承認は日本語のまま**扱う。
 * 「次の工程へトス」だけがブランドオレンジで、工程を前へ進める唯一の操作である
 * ことを色で示す。それ以外は濃色 (渡す・承認) と枠線のみ (戻す) で区別する。
 */
export const WORKFLOW_ACTIONS = ['review-toss', 'comment-return', 'approve', 'next-toss'] as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export const WORKFLOW_ACTION_SPEC: Record<
  WorkflowAction,
  { label: string; variant: 'default' | 'outline' | 'accent' }
> = {
  'review-toss': { label: 'ボールを渡す', variant: 'default' },
  'comment-return': { label: 'ボールを戻す', variant: 'outline' },
  approve: { label: '承認', variant: 'default' },
  'next-toss': { label: '次の工程へトス', variant: 'accent' },
};

export function workflowActionLabel(action: WorkflowAction): string {
  return WORKFLOW_ACTION_SPEC[action].label;
}
