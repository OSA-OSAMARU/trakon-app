import { useCurrentUser } from '@/features/auth/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';

/**
 * Sub-Phase 0.1: ダッシュボードはプレースホルダ。
 * 本実装は Sub-Phase 0.4 (SC-09) で行う。
 */
export function DashboardPage() {
  const { data } = useCurrentUser();
  const user = data && !data.requiresProfileCompletion ? data.user : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">TRAKON</h1>
        <Button variant="outline" size="sm" onClick={() => supabase.auth.signOut()}>
          サインアウト
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">ようこそ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {user ? (
            <>
              <p>
                <span className="text-muted-foreground">表示名 / </span>
                <span className="font-medium">{user.displayName}</span>
              </p>
              <p>
                <span className="text-muted-foreground">メール / </span>
                <span className="font-medium">{user.email}</span>
              </p>
              <p>
                <span className="text-muted-foreground">認証方式 / </span>
                <span className="font-medium">{user.primaryAuthMethod}</span>
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">ユーザー情報を取得中…</p>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        ダッシュボード本体は Sub-Phase 0.4 で実装します。
      </p>
    </main>
  );
}
