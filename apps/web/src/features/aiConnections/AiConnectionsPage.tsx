import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Bot, Copy, Unplug } from 'lucide-react';
import { toast } from 'sonner';

import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

import { AI_GUIDES } from './aiGuides';
import { aiApi, aiConnectionsQueryKey, mcpServerUrl, type AiConnection } from './api';

function formatDateTime(iso: string): string {
  return format(new Date(iso), 'yyyy/MM/dd HH:mm');
}

/**
 * SC-21 AI 連携 (`/settings/ai`) — 設計書 08-mcp §8.10
 *
 * Claude・ChatGPT などの AI アシスタントから TRAKON の予定を操作するための接続先 URL と、
 * 接続中のアプリの一覧・接続解除。接続そのものは AI アプリ側から始め、同意画面 (SC-20) で許可する。
 */
export function AiConnectionsPage() {
  const url = mcpServerUrl();
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<AiConnection | null>(null);

  const connections = useQuery({
    queryKey: aiConnectionsQueryKey,
    queryFn: aiApi.listConnections,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => aiApi.revokeConnection(id),
    onSuccess: () => {
      toast.success('接続を解除しました');
      setRevoking(null);
      void queryClient.invalidateQueries({ queryKey: aiConnectionsQueryKey });
    },
    onError: () => toast.error('接続を解除できませんでした'),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('URL をクリップボードにコピーしました');
    } catch {
      toast.error('コピーに失敗しました');
    }
  };

  return (
    <PageContainer width="md">
      <PageHeader
        title="AI 連携"
        description="Claude や ChatGPT などの AI アシスタントに話しかけるだけで、予定の確認・登録・変更ができるようになります。"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-heading-section">接続のしかた</CardTitle>
          <CardDescription>
            AI アプリの設定に次の URL を貼り付けて接続してください。TRAKON
            の画面が開いたら、内容を確認して「許可する」を押します。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex gap-2">
            <Input value={url} readOnly aria-label="MCP サーバの URL" className="font-mono" />
            <Button variant="secondary" onClick={copy} aria-label="URL をコピー">
              <Copy className="size-4" />
              コピー
            </Button>
          </div>
          <div className="space-y-2 text-body">
            <p className="font-medium">サービス別の設定方法</p>
            <ul className="flex flex-wrap gap-2">
              {AI_GUIDES.map((g) => (
                <li key={g.id}>
                  <Link
                    to={`/help/ai#${g.id}`}
                    className="inline-block rounded-full border border-border px-3 py-1 text-label hover:bg-surface-subtle"
                  >
                    {g.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              to="/help/ai"
              className="inline-flex items-center gap-1 text-label underline underline-offset-2"
            >
              設定方法を詳しく見る
            </Link>
          </div>
          <p className="text-text-secondary text-label">
            AI
            からできる操作は、あなたが参加しているプロジェクトと、そこでのあなたの権限の範囲に限られます。
            予定や参加者の名前などの情報は接続先の AI サービスに送られます。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-heading-section">接続中のアプリ</CardTitle>
        </CardHeader>
        <CardContent>
          {connections.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : connections.error ? (
            <p className="text-body text-destructive">接続中のアプリを取得できませんでした。</p>
          ) : connections.data && connections.data.length > 0 ? (
            <ul className="divide-y">
              {connections.data.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Bot className="text-text-tertiary size-5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-body font-medium">{c.clientName}</span>
                      <Badge variant="neutral" size="sm">
                        {c.scopes.includes('write') ? '閲覧・編集' : '閲覧のみ'}
                      </Badge>
                    </div>
                    <p className="text-text-secondary text-label">
                      接続日 {formatDateTime(c.createdAt)} ・ 最終利用{' '}
                      {c.lastUsedAt ? formatDateTime(c.lastUsedAt) : 'まだありません'}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setRevoking(c)}>
                    <Unplug className="size-4" />
                    接続を解除
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-secondary text-body">接続中のアプリはありません。</p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{revoking?.clientName}」の接続を解除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              解除すると、このアプリからは TRAKON
              を操作できなくなります。もう一度使うには、アプリ側から接続し直してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (revoking) revoke.mutate(revoking.id);
              }}
              disabled={revoke.isPending}
            >
              接続を解除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
