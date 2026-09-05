/**
 * プロジェクト権限ロール (FE/BE 共通)
 * 設計書 §7.12 / §5.4.2 / PRD §4.1.12c (FR-ROLE-01〜04)、§9.4
 *
 * ロールは `project_members.role_type` の 3 値であり、**操作権限の唯一の根拠**。
 * 区分 (member_type: production / client / partner) と職種 (job_title) は
 * 表示専用で、権限の判定に使ってはならない (PRD SR-AUTHZ-05)。
 *
 * 例外: プロジェクト作成者は role_type の値によらず常に admin として扱う。
 *       自分のプロジェクトから締め出されることを防ぐ最終防衛線 (FR-ROLE-04)。
 *       この解決は BE の requireProjectMember() が行う。
 *
 * ---
 * この 1 ファイルがロール別操作可否の単一の定義であり、ミドルウェア・サービス層・
 * フロントエンドはすべてここを参照する。方針を変えるときは PROJECT_ROLE_MATRIX
 * だけを書き換えれば全体に伝播する (設計書 §7.12.4)。
 */

export const PROJECT_ROLES = ['admin', 'editor', 'viewer'] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = {
  admin: '管理者',
  editor: '編集者',
  viewer: '閲覧者',
};

export const PROJECT_ROLE_DESCRIPTION: Record<ProjectRole, string> = {
  admin: 'プロジェクトの設定・参加者・制作物を管理し、TOSS でボールを次工程へ渡せます',
  editor: '予定の作成・変更・削除ができます。TOSS はできません',
  viewer: '閲覧と、自分が担当する予定の確認・承認・差し戻しができます',
};

export function isProjectRole(value: string): value is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(value);
}

/**
 * 権限で制御する操作の一覧。
 *
 * `plan.complete` について:
 *   権限メモの「タスク完了」に相当し、確認依頼 / 承認 / 差し戻し / 各取り消しを
 *   **すべて 1 つの権限単位に集約**している。承認者が閲覧者のときに承認だけ許して
 *   確認依頼を禁じると、確認待ちのまま永久に進行不能になるため (設計書 §7.12.3)。
 *
 * `plan.toss` について:
 *   TOSS と TOSS 取り消しを含む。TOSS の裏返しであり権限を分ける理由がない。
 */
export const PROJECT_ACTIONS = [
  'project.view',
  'project.update',
  'project.archive',
  'item.create',
  'item.update',
  'item.delete',
  'plan.create',
  'plan.update',
  'plan.delete',
  /** 確認依頼・承認・差し戻し・各取り消し (＝権限メモの「タスク完了」) */
  'plan.complete',
  /** TOSS・TOSS 取り消し */
  'plan.toss',
  'member.create',
  'member.update',
  'member.remove',
  'member.invite',
  'share_link.view',
  'share_link.create',
  'share_link.revoke',
  /** Phase 1 のコメント機能。定義のみ置き、実装は後続 */
  'comment.create',
] as const;

export type ProjectAction = (typeof PROJECT_ACTIONS)[number];

/**
 * 操作 → 許可ロール。
 *
 * 「操作 → ロール」の向きにしているのは、操作を追加したときに
 * どのロールへ許すかの宣言を型で強制するため (Record の網羅性チェックが効く)。
 */
export const PROJECT_ROLE_MATRIX: Record<ProjectAction, readonly ProjectRole[]> = {
  'project.view': ['admin', 'editor', 'viewer'],
  'project.update': ['admin'],
  'project.archive': ['admin'],

  // 制作物の追加・削除は管理者のみ (権限メモ)
  'item.create': ['admin'],
  'item.update': ['admin'],
  'item.delete': ['admin'],

  // 「スケジュール追加 / 変更 / 削除」は管理者・編集者 (権限メモ)
  'plan.create': ['admin', 'editor'],
  'plan.update': ['admin', 'editor'],
  'plan.delete': ['admin', 'editor'],

  // 「タスク完了」は全ロール (権限メモ)。ただしボール保持者条件は別途かかる
  'plan.complete': ['admin', 'editor', 'viewer'],

  // TOSS は管理者のみ (権限メモ)。副作用は設計書 §7.12.4 に記録済み
  'plan.toss': ['admin'],

  'member.create': ['admin'],
  'member.update': ['admin'],
  'member.remove': ['admin'],
  'member.invite': ['admin'],

  'share_link.view': ['admin', 'editor', 'viewer'],
  'share_link.create': ['admin'],
  'share_link.revoke': ['admin'],

  'comment.create': ['admin', 'editor', 'viewer'],
};

/** ロールがその操作を許可されているか */
export function canProjectRole(role: ProjectRole, action: ProjectAction): boolean {
  return PROJECT_ROLE_MATRIX[action].includes(role);
}

/** ボール操作 (完了フロー / TOSS) の action */
export type BallProjectAction = Extract<ProjectAction, 'plan.complete' | 'plan.toss'>;

/**
 * ボール操作の 2 段判定 (設計書 §7.12.2)。
 *
 *   1. ロールがその操作を許可しているか
 *   2. 管理者なら通す (ボール保持者でなくても可 = 上位権限)
 *   3. それ以外はボール保持者本人であること
 */
export function canPerformBallAction(input: {
  role: ProjectRole;
  action: BallProjectAction;
  isHolder: boolean;
}): boolean {
  if (!canProjectRole(input.role, input.action)) return false;
  if (input.role === 'admin') return true;
  return input.isHolder;
}

/** そのロールで実行できる操作の一覧 (FE のデバッグ・テスト用) */
export function allowedProjectActions(role: ProjectRole): ProjectAction[] {
  return PROJECT_ACTIONS.filter((action) => canProjectRole(role, action));
}
