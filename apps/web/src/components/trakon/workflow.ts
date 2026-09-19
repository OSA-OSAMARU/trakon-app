/**
 * ボール操作の定義 (Figma「Components / Workflow Button」node 206:380)。
 *
 * Figma の注記どおり **TOSS / RETURN は大文字で統一し、承認は日本語のまま**扱う。
 * 「次の工程へトス」だけがブランドオレンジ (Role=Brand) で、工程を前へ進める唯一の
 * 操作であることを色で示す。それ以外は黒 (Role=Primary: 渡す・承認) と
 * 白 + 枠線 (Role=Secondary: 戻す) で区別する。
 *
 * 補足: ガイド「03 Button」(node 237:40) §01 の本文は「確認依頼の TOSS → Brand」と
 * 書いているが、コンポーネント実体 206:380 では「ボールを渡す」は黒である。
 * オレンジを 1 操作に限定する上記の設計意図を優先し、実体側に合わせている。
 */
export const WORKFLOW_ACTIONS = ['review-toss', 'comment-return', 'approve', 'next-toss'] as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export const WORKFLOW_ACTION_SPEC: Record<
  WorkflowAction,
  { label: string; role: 'primary' | 'secondary' | 'brand' }
> = {
  'review-toss': { label: 'ボールを渡す', role: 'primary' },
  'comment-return': { label: 'ボールを戻す', role: 'secondary' },
  approve: { label: '承認', role: 'primary' },
  'next-toss': { label: '次の工程へトス', role: 'brand' },
};

export function workflowActionLabel(action: WorkflowAction): string {
  return WORKFLOW_ACTION_SPEC[action].label;
}
