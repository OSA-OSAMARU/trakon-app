import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { MemberCandidate } from './api';
import { orgMemberLabel, useSelectableOrgMembers } from './useOrgMembers';

type SelectProps = {
  value: string;
  onChange: (userId: string) => void;
  exclude?: string[];
  /** aria-label。同じ画面に複数置くので呼び出し側で区別できる文言にする */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'default';
};

/**
 * 候補から 1 人選ぶセレクト (#202)。候補は呼び出し側が渡す。
 *
 * `exclude` に既に選ばれている userId を渡すと、その人は候補から外れる
 * (同じ人を二重に追加できないようにするため)。
 */
export function MemberSelect({
  options: all,
  isLoading,
  value,
  onChange,
  exclude = [],
  label,
  placeholder = 'メンバーを選択',
  disabled,
  size,
}: SelectProps & { options: MemberCandidate[]; isLoading?: boolean }) {
  const excluded = new Set(exclude.filter((id) => id !== value));
  const options = all.filter((m) => !excluded.has(m.userId));

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || isLoading}>
      <SelectTrigger size={size} aria-label={label}>
        <SelectValue placeholder={isLoading ? '読み込み中…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 ? (
          <div className="text-text-tertiary px-3 py-2 text-label">
            選べるメンバーがいません
          </div>
        ) : (
          options.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              <span className="flex items-center gap-2">
                <Avatar name={m.name} src={m.avatarUrl} className="size-5 text-micro" />
                {orgMemberLabel(m)}
              </span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

/**
 * 既定組織のメンバーから選ぶセレクト (#202)。
 * プロジェクトがまだ無い場面 (新規作成) 用。既存プロジェクトでは
 * そのプロジェクトの組織から引いた候補を `MemberSelect` に渡すこと (#238)。
 */
export function OrgMemberSelect(props: SelectProps) {
  const { members, isLoading } = useSelectableOrgMembers();
  return <MemberSelect {...props} options={members} isLoading={isLoading} />;
}

/**
 * 候補が居ないときに出す案内 (#202)。
 *
 * 参加者は組織メンバーからしか選べないので、行き止まりにせず
 * 「まずメンバー管理で招待する」という次の一手を示す。
 */
export function NoOrgMembersHint({ className }: { className?: string }) {
  return (
    <p className={className}>
      プロジェクトに追加できるのは
      <MembersLink />
      に登録済みのメンバーだけです。まだ居ない場合は、先にそちらから招待してください。
    </p>
  );
}

/**
 * 候補が空になった**理由**を出す (#238)。
 *
 * 「追加する」が押せない原因は 3 通りあり、同じ文面ではどれなのか分からない。
 * 利用者が次に何をすればよいか (招待する / 承諾を待つ / 何もしなくてよい) が
 * 変わるので、数から言い分ける。
 */
export function NoCandidatesHint({
  joinedCount,
  pendingCount,
  className,
}: {
  /** 既にこのプロジェクトに居るため候補から外れた人数 */
  joinedCount: number;
  /** 未受諾の招待の数 */
  pendingCount: number;
  className?: string;
}) {
  if (joinedCount > 0) {
    return (
      <p className={className}>
        <MembersLink />
        に登録済みのメンバー {joinedCount} 名は、全員このプロジェクトに参加済みです。
        {pendingCount > 0 &&
          ` 招待中の ${pendingCount} 名は、承諾してアカウントが作られると選べるようになります。`}
      </p>
    );
  }
  if (pendingCount > 0) {
    return (
      <p className={className}>
        招待中の {pendingCount} 名は、まだ承諾されていないため選べません。承諾して
        アカウントが作られると、ここから追加できるようになります。
      </p>
    );
  }
  return <NoOrgMembersHint className={className} />;
}

function MembersLink() {
  return (
    <Link to="/settings/members" className="text-foreground mx-1 underline underline-offset-2">
      メンバー管理
    </Link>
  );
}
