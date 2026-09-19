import { JOB_TITLE_LABEL, MEMBER_TYPE_LABEL } from '@trakon/shared';

import { Avatar } from '@/components/ui/avatar';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import type { ProjectMember } from './membersApi';

/**
 * 参加者のプロフィールをホバーで出すカード (#159)。
 *
 * 表示は 名前 / 所属名 / メールアドレス / 職種。値は参加者一覧 API から来る
 * (アカウント紐付け済みならマイページの内容が read-through で反映される、#156)。
 *
 * **非会員の共有ページ (/share/:token) では使わない。** ここにはメールアドレスが
 * 含まれるため、認証済みの画面から `member` を渡されたときだけ包む設計にしている
 * (member が無ければ子をそのまま返す)。共有ページは参加者一覧を取得しないので、
 * 構造的に渡しようがない。
 */
export function MemberProfileHover({
  member,
  /**
   * トリガーをタブ順に含めるか。
   * スケジュールのカード上は 1 予定あたり最大 3 人分あり、全部をタブ順に入れると
   * ボードの移動が困難になる。カード自体は Enter で詳細を開けるので、
   * 密なボード側は false、サイドモーダル側は true にする。
   */
  focusable = false,
  children,
}: {
  member?: ProjectMember | null;
  focusable?: boolean;
  children: React.ReactNode;
}) {
  if (!member) return <>{children}</>;

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span tabIndex={focusable ? 0 : -1} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent>
        <MemberProfileCard member={member} />
      </HoverCardContent>
    </HoverCard>
  );
}

export function MemberProfileCard({ member }: { member: ProjectMember }) {
  return (
    <div className="flex gap-3">
      <Avatar name={member.name} src={member.avatarUrl} className="size-10 text-body" />
      <dl className="min-w-0 flex-1 space-y-0.5">
        <dt className="sr-only">名前</dt>
        <dd className="truncate text-body font-medium">{member.name}</dd>

        <dt className="sr-only">所属名</dt>
        <dd className="text-text-secondary truncate text-label">
          {member.organizationName || '所属未設定'}
        </dd>

        <dt className="sr-only">メールアドレス</dt>
        <dd className="text-text-tertiary truncate text-label">
          {member.email ?? 'メール未登録'}
        </dd>

        <dt className="sr-only">職種</dt>
        <dd className="text-text-tertiary text-label">
          {member.jobTitle ? JOB_TITLE_LABEL[member.jobTitle] : '職種未設定'}
          <span className="text-text-tertiary"> ・ {MEMBER_TYPE_LABEL[member.memberType]}</span>
        </dd>
      </dl>
    </div>
  );
}
