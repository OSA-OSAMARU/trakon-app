import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ExternalLink } from 'lucide-react';

import { BILLING_PLANS } from '@trakon/shared';

import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { adminApi, adminQueryKey, type PlatformMetrics } from './api';

/**
 * 運営管理画面 (#204)。
 *
 * 答えたい問いは 2 つだけ ―「いま何人が使っているか」と「そのうち何人が有料か」。
 * **金額は出さない。** 売上・請求・返金は Stripe ダッシュボードが正で、ここに数字を
 * 置くと必ずズレて、どちらが正しいか言えなくなる。この画面は
 * 「Stripe を見に行く前に人数の傾向を掴む」ためのもの。
 *
 * 到達できるのは `TRAKON_OPERATOR_EMAILS` に載っているアカウントだけ。
 * それ以外には API が 404 を返す (画面の存在自体を気取らせない)。
 */
export function AdminPage() {
  const query = useQuery({
    queryKey: adminQueryKey.metrics,
    queryFn: () => adminApi.metrics(),
    // 運営が開いたときの最新を見たいので、キャッシュは短く
    staleTime: 30_000,
  });

  return (
    <>
      <PageHeader
        title="運営管理"
        description="TRAKON 全体の利用状況を確認します"
        actions={
          // 金額はここに置かない。Stripe へ送る
          <a
            href="https://dashboard.stripe.com/"
            target="_blank"
            rel="noreferrer"
            className="text-text-secondary hover:text-foreground flex items-center gap-1.5 text-label underline-offset-2 hover:underline"
          >
            <ExternalLink className="size-4" aria-hidden />
            売上は Stripe ダッシュボード
          </a>
        }
      />
      <PageContainer>
        {query.isLoading && <Skeleton className="h-64 w-full rounded-md" />}
        {query.error && (
          <p className="text-body text-destructive">利用状況を取得できませんでした</p>
        )}
        {query.data && <Metrics data={query.data} />}
      </PageContainer>
    </>
  );
}

function Metrics({ data }: { data: PlatformMetrics }) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="会員アカウント" testId="users" value={data.users.total} unit="人" />
        <Tile
          label="直近 30 日の新規"
          testId="new-users"
          value={data.users.newIn30Days}
          unit="人"
        />
        <Tile
          label="有料の組織"
          testId="paid-orgs"
          value={data.organizations.paid}
          unit={`/ ${data.organizations.total} 組織`}
        />
        <Tile
          label="アクティブなプロジェクト"
          testId="active-projects"
          value={data.projects.active}
          unit="件"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-heading-section">プラン別の内訳</CardTitle>
          <p className="text-text-secondary mt-0.5 text-label">
            契約プランではなく<strong>実効プラン</strong>
            で数えています。解約済み・支払い不能の組織は Free として計上されます。
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>プラン</TableHead>
                <TableHead className="text-right">組織</TableHead>
                <TableHead className="text-right">会員アカウント</TableHead>
                <TableHead className="text-right">アクティブなプロジェクト</TableHead>
                <TableHead className="text-right">うちトライアル中</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.planBreakdown.map((r) => (
                <TableRow key={r.planCode}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {BILLING_PLANS[r.planCode].label}
                      {r.planCode !== 'free' && (
                        <Badge variant="neutral" size="sm">
                          有料
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.organizationCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.memberCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.activeProjectCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.trialingCount || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-heading-section">気にかけたい数字</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Tile
            label="アーカイブ済みプロジェクト"
            testId="archived-projects"
            value={data.projects.archived}
            unit="件"
            hint="アクティブ枠を空けるための正規の動線。増えていれば上限に当たっている組織がある"
          />
          <Tile
            label="どの組織にも属していない会員"
            testId="orphan-users"
            value={data.users.withoutOrganization}
            unit="人"
            hint="通常は 0。増えていたら登録フローの取りこぼしを疑う"
          />
        </CardContent>
      </Card>

      {/* いつ時点の数字かを明示する。キャッシュ越しに古い値を見ている可能性があるため */}
      <p className="text-text-tertiary text-label">
        集計時刻: {format(parseISO(data.generatedAt), 'yyyy/M/d HH:mm')}
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  hint,
  testId,
}: {
  label: string;
  value: number;
  unit: string;
  hint?: string;
  testId: string;
}) {
  return (
    <div className="bg-accent rounded-lg px-4 py-3" data-testid={`metric-${testId}`}>
      <p className="text-text-secondary text-label">{label}</p>
      <p className="mt-1 text-heading-section font-semibold tabular-nums">
        {value.toLocaleString()}
        <span className="text-text-secondary ml-1 text-label font-normal">{unit}</span>
      </p>
      {hint && <p className="text-text-tertiary mt-1 text-label">{hint}</p>}
    </div>
  );
}
