import type { ProjectRole } from '../domain/projectRole.js';

/**
 * 招待 API (`/invitations/:token`) の応答型 — **FE/BE 共通の唯一の定義**。
 *
 * ここに置いている理由:
 *   以前は BE のサービス層と FE の `features/invitations/api.ts` が同じ形を
 *   別々に宣言していた。#189 で組織単位の招待を足した際に BE 側だけ
 *   `invitedMember` → `invitee` / `project` を null 許容へ変えたため、
 *   FE は古い形のまま型検査を通過し、受諾画面が `project.name` の参照で
 *   実行時に落ちて**白画面**になった (#228)。
 *   型を 1 箇所にすれば、次に BE を変えたときは FE の型検査が落ちる。
 */

/**
 * 招待のスコープ (#160)。
 *   project … 特定プロジェクトへの招待。受諾でその参加者行に紐づく
 *   org     … 組織への招待。受諾では組織メンバーになり、同じメール宛に
 *             用意されていた参加者行があればまとめて紐づく
 */
export type InvitationScope = 'project' | 'org';

/** `GET /invitations/:token` (未認証可) */
export type InvitationVerifyDTO = {
  scope: InvitationScope;
  /** 組織単位の招待では null */
  project: { id: string; name: string } | null;
  /** 招待元の組織名。組織単位の招待ではこれが見出しになる */
  organizationName: string;
  /** 招待の宛先。氏名は参加者行 or 招待行から取るため空文字になりうる */
  invitee: {
    name: string;
    email: string;
    /** 招待先本人の所属名。未入力なら空文字 */
    organizationName: string;
    roleType: ProjectRole;
  };
  expiresAt: string;
};

/** `POST /invitations/:token/accept` */
export type InvitationAcceptDTO = {
  scope: InvitationScope;
  /** 組織単位の招待では null */
  project: { id: string; name: string } | null;
  /** 受諾で紐づいた参加者行。組織単位で 1 件も無ければ空 */
  members: Array<{ id: string; projectId: string; roleType: ProjectRole }>;
};

/**
 * `POST /invitations/:token/accept` を伴う直接登録 (#233)。
 *
 * 招待メールを受け取れた時点でそのアドレスの所有は確かめられているので、
 * 確認メールをもう 1 通送らずにアカウントを作り、そのまま組織に参加させる。
 */
export type InvitationSignupDTO = {
  /** 作成したアカウントのログイン用メール。FE はこれでサインインする */
  email: string;
  /** 受諾の結果。scope / project の意味は InvitationAcceptDTO と同じ */
  accepted: InvitationAcceptDTO;
};
