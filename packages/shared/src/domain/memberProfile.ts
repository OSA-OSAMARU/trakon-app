/**
 * 参加者プロフィールの解決 (FE/BE 共通)
 * issue #156 / #159
 *
 * 所属名・職種・メールアドレスは **アカウント (users) 側を正**とし、
 * project_members 側の値はアカウント未紐付けの参加者のための値として扱う (read-through)。
 *
 * この形にした理由:
 *   - マイページで所属名を直したら、参加している全プロジェクトの表示に即反映されてほしい。
 *     スナップショット方式だと、直す手段がどこにも無いまま古い値が残り続ける。
 *   - マイページの保存が project_members への一括 UPDATE に波及しない。
 *   - フリープランの「予定上に表示されるだけのメンバー」(user_id IS NULL) は
 *     users を持たないので、これまでどおり自分の値がそのまま使われる。
 *
 * 氏名 (name) だけは参加者行のままにする。スケジュールカードに出る名前であり、
 * 「A社の山田さん」のようにプロジェクトごとの呼び分けが実際にありうるため。
 */

/** 解決の入力になる参加者行 (project_members)。 */
export type MemberProfileSource = {
  name: string;
  organizationName: string;
  jobTitle: string | null;
  /** 参加者行のメール。招待の宛先・重複判定に使う列で、表示は user 側を優先する */
  email: string | null;
};

/** 解決の入力になるアカウント行 (users)。未紐付けなら null。 */
export type UserProfileSource = {
  organizationName: string | null;
  jobTitle: string | null;
  /** 通知先メール (未設定なら null) */
  notificationEmail: string | null;
  /** ログイン用メール */
  email: string;
  avatarPath: string | null;
};

export type ResolvedMemberProfile = {
  name: string;
  organizationName: string;
  jobTitle: string | null;
  email: string | null;
  avatarPath: string | null;
};

/**
 * 通知先メールを解決する。未設定ならログイン用メールにフォールバックする。
 * 通知の宛先も画面の表示もこの 1 か所を通す。
 */
export function effectiveNotificationEmail(user: {
  notificationEmail: string | null;
  email: string;
}): string {
  return user.notificationEmail?.trim() || user.email;
}

/**
 * 表示用の参加者プロフィールを解決する。
 *
 * 所属名は空文字も「未設定」として扱う (project_members.organization_name は
 * NOT NULL DEFAULT '' のため、NULL ではなく '' が入る)。
 */
export function resolveMemberProfile(input: {
  member: MemberProfileSource;
  user?: UserProfileSource | null;
}): ResolvedMemberProfile {
  const { member, user } = input;
  return {
    name: member.name,
    organizationName: member.organizationName || user?.organizationName || '',
    jobTitle: member.jobTitle ?? user?.jobTitle ?? null,
    email: user ? effectiveNotificationEmail(user) : (member.email ?? null),
    avatarPath: user?.avatarPath ?? null,
  };
}
