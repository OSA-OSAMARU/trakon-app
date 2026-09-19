import { Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { orgMemberLabel, useSelectableOrgMembers } from './useOrgMembers';

/**
 * 組織メンバーを 1 人選ぶセレクト (#202)。
 *
 * 氏名やメールを手入力する代わりに、既にアカウントを持っている人から選ばせる。
 * `exclude` に既に選ばれている userId を渡すと、その人は候補から外れる
 * (同じ人を二重に追加できないようにするため)。
 */
export function OrgMemberSelect({
  value,
  onChange,
  exclude = [],
  label,
  placeholder = 'メンバーを選択',
  disabled,
  size,
}: {
  value: string;
  onChange: (userId: string) => void;
  exclude?: string[];
  /** aria-label。同じ画面に複数置くので呼び出し側で区別できる文言にする */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'default';
}) {
  const { members, isLoading } = useSelectableOrgMembers();
  const excluded = new Set(exclude.filter((id) => id !== value));
  const options = members.filter((m) => !excluded.has(m.userId));

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
 * 候補が居ないときに出す案内 (#202)。
 *
 * 参加者は組織メンバーからしか選べないので、行き止まりにせず
 * 「まずメンバー管理で招待する」という次の一手を示す。
 */
export function NoOrgMembersHint({ className }: { className?: string }) {
  return (
    <p className={className}>
      プロジェクトに追加できるのは
      <Link to="/settings/members" className="text-foreground mx-1 underline underline-offset-2">
        メンバー管理
      </Link>
      に登録済みのメンバーだけです。まだ居ない場合は、先にそちらから招待してください。
    </p>
  );
}
