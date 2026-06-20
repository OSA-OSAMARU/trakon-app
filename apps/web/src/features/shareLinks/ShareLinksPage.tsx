import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, Copy, Link2, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiClientError } from '@/lib/api';
import { projectsApi, projectsQueryKey } from '@/features/projects/api';
import { shareLinksApi, shareLinksQueryKey, type ShareLink } from './api';

/**
 * SC-16 共有リンク発行・管理画面 (/projects/:projectId/share-links)
 *  - 発行: scope (project|item|plan) を選択して新規発行、URL は発行時のみ表示
 *  - 一覧: 発行済みリンクの一覧 + revoke
 */
export function ShareLinksPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;

  return <Inner projectId={projectId} />;
}

function Inner({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ShareLink | null>(null);

  const linksQuery = useQuery({
    queryKey: shareLinksQueryKey.list(projectId),
    queryFn: () => shareLinksApi.list(projectId),
  });
  const itemsQuery = useQuery({
    queryKey: projectsQueryKey.items(projectId),
    queryFn: () => projectsApi.listItems(projectId),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => shareLinksApi.revoke(projectId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shareLinksQueryKey.list(projectId) });
      toast.success('共有リンクを失効しました');
      setRevoking(null);
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '失効に失敗しました'),
  });

  return (
    <>
      <PageHeader
        width="lg"
        title="共有リンク"
        description="クライアントなど非会員に閲覧・操作用 URL を発行します"
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/projects/${projectId}/edit`}>
              <ArrowLeft className="size-4" />
              プロジェクト設定
            </Link>
          </Button>
        }
      />
      <PageContainer width="lg">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">発行済みリンク</CardTitle>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Link2 className="size-4" />
              新規発行
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {linksQuery.isLoading && <Skeleton className="h-24 rounded-md" />}
          {linksQuery.data && linksQuery.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              発行済みのリンクはありません。
            </p>
          )}
          <ul className="divide-y divide-border">
            {linksQuery.data?.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 py-3">
                <div className="space-y-0.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        s.status === 'active'
                          ? 'default'
                          : s.status === 'revoked'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {s.status === 'active'
                        ? '有効'
                        : s.status === 'revoked'
                          ? '失効'
                          : '期限切れ'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      scope: {s.scopeType}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.expiresAt
                      ? `期限 ${format(new Date(s.expiresAt), 'yyyy/M/d HH:mm')}`
                      : '期限 無期限'}
                    {s.lastAccessedAt &&
                      ` ・ 最終アクセス ${format(new Date(s.lastAccessedAt), 'M/d HH:mm')}`}
                  </p>
                </div>
                {s.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRevoking(s)}
                    aria-label="失効"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {creating && (
        <CreateDialog
          projectId={projectId}
          items={itemsQuery.data ?? []}
          onClose={() => setCreating(false)}
          onIssued={(url) => {
            setIssuedUrl(url);
            qc.invalidateQueries({ queryKey: shareLinksQueryKey.list(projectId) });
          }}
        />
      )}

      {issuedUrl && (
        <IssuedDialog url={issuedUrl} onClose={() => setIssuedUrl(null)} />
      )}

      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>共有リンクを失効しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              失効後はそのリンクからのアクセスが拒否されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (revoking) revokeMut.mutate(revoking.id);
              }}
              disabled={revokeMut.isPending}
            >
              失効
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </PageContainer>
    </>
  );
}

function CreateDialog({
  projectId,
  items,
  onClose,
  onIssued,
}: {
  projectId: string;
  items: Array<{ id: string; name: string }>;
  onClose: () => void;
  onIssued: (url: string) => void;
}) {
  const [scope, setScope] = useState<'project' | 'item'>('project');
  const [itemId, setItemId] = useState<string>('');
  // 有効期限プリセット (null = 無期限)。デフォルトは 1週間
  const [hours, setHours] = useState<number | null>(168);

  const createMut = useMutation({
    mutationFn: () =>
      shareLinksApi.create(projectId, {
        scopeType: scope,
        scopeTargetId: scope === 'item' ? itemId : undefined,
        expiresInHours: hours,
      }),
    onSuccess: (res) => {
      toast.success('共有リンクを発行しました');
      onIssued(res.url);
      onClose();
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '発行に失敗しました'),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>共有リンクを発行</DialogTitle>
          <DialogDescription>
            発行直後のみ完全な URL が表示されます。コピーして外部に共有してください。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>スコープ</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as 'project' | 'item')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">プロジェクト全体</SelectItem>
                <SelectItem value="item" disabled={items.length === 0}>
                  特定の制作物のみ
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === 'item' && (
            <div className="space-y-1.5">
              <Label>制作物</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger>
                  <SelectValue placeholder="制作物を選択" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((it) => (
                    <SelectItem key={it.id} value={it.id}>
                      {it.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>有効期限</Label>
            <Select
              value={hours === null ? 'none' : String(hours)}
              onValueChange={(v) => setHours(v === 'none' ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">1日</SelectItem>
                <SelectItem value="72">3日</SelectItem>
                <SelectItem value="168">1週間</SelectItem>
                <SelectItem value="720">30日</SelectItem>
                <SelectItem value="none">無期限</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={() => createMut.mutate()}
            disabled={
              createMut.isPending || (scope === 'item' && !itemId)
            }
          >
            {createMut.isPending && <Loader2 className="size-4 animate-spin" />}
            発行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssuedDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('URL をクリップボードにコピーしました');
    } catch {
      toast.error('コピーに失敗しました');
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>共有リンクを発行しました</DialogTitle>
          <DialogDescription>
            この URL は今だけ表示されます。閉じると二度と表示できません。必ずコピーしてください。
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input value={url} readOnly className="font-mono text-xs" />
          <Button type="button" onClick={copy}>
            <Copy className="size-4" />
            コピー
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>閉じる</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
