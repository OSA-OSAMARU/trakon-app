import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CurrentUser } from './api';

const AUTH_METHOD_LABEL: Record<CurrentUser['primaryAuthMethod'], string> = {
  password: 'メール + パスワード',
  google: 'Google',
  microsoft: 'Microsoft',
};

/**
 * プロフィール表示モーダル (プロトタイプ ProfileModal の表示部)。
 * 氏名/組織/パスワードの編集は更新 API 未実装のため将来対応 (Phase 1)。
 */
export function ProfileModal({
  user,
  open,
  onClose,
  onSignOut,
}: {
  user: CurrentUser;
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const initial = (user.displayName || user.fullName || user.email).charAt(0).toUpperCase();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>アカウント</DialogTitle>
          <DialogDescription>プロフィール情報を確認できます。</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{user.displayName}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">氏名</dt>
          <dd>{user.fullName}</dd>
          <dt className="text-muted-foreground">表示名</dt>
          <dd>{user.displayName}</dd>
          <dt className="text-muted-foreground">認証方法</dt>
          <dd>{AUTH_METHOD_LABEL[user.primaryAuthMethod]}</dd>
        </dl>

        <p className="text-[11px] text-muted-foreground">
          氏名・パスワードの変更は今後のリリースで対応予定です。
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            閉じる
          </Button>
          <Button variant="outline" onClick={onSignOut}>
            <LogOut className="size-4" />
            サインアウト
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
