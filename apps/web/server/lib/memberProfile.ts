/**
 * 参加者プロフィールの read-through (#156 / #254) に必要な users の列。
 *
 * 表示名・所属名・職種・メール・アイコンはアカウント (users) 側を正とするため、
 * project_members を引くクエリは **必ずこの select で user を include する**。
 * 1 つでも漏らすと「その画面だけ古い名前が出る」という #254 の再発になるので、
 * 定義はここ 1 か所に集約している。
 */
export const MEMBER_PROFILE_USER_SELECT = {
  select: {
    displayName: true,
    organizationName: true,
    jobTitle: true,
    notificationEmail: true,
    email: true,
    avatarPath: true,
  },
} as const;

/** MEMBER_PROFILE_USER_SELECT で取得した users 行の形。 */
export type MemberProfileUserRow = {
  displayName: string;
  organizationName: string | null;
  jobTitle: string | null;
  notificationEmail: string | null;
  email: string;
  avatarPath: string | null;
};
