import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api';

import { attachmentsApi, plansQueryKey, type Attachment } from './api';
import { formatBytes } from './formatBytes';

/**
 * 予定への添付ファイル (#65 / PRD §8.2)。
 *
 * ボール詳細の「概要」タブに置く。#206 で添えられるようになったメッセージが
 * 「何をしてほしいか」なら、ここは**その対象そのもの**（支給素材・確認用の書き出し）。
 *
 * ダウンロードは**都度発行される署名付き URL**で行う（直リンク禁止）。
 * URL は 10 分で失効するので、一覧を開いたまま放置した後は再取得が要る。
 */
export function PlanAttachments({
  projectId,
  itemId,
  planId,
  myMemberId,
  canUpload,
  isAdmin,
}: {
  projectId: string;
  itemId: string;
  planId: string;
  /** 自分の参加者 ID。自分が入れたファイルだけ削除できる */
  myMemberId: string | null;
  canUpload: boolean;
  /** 管理者は他人のファイルも削除できる */
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryKey = plansQueryKey.attachments(projectId, itemId, planId);

  const query = useQuery({
    queryKey,
    queryFn: () => attachmentsApi.list(projectId, itemId, planId),
    // 署名付き URL が短命なので、開き直すたびに取り直す
    staleTime: 0,
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => attachmentsApi.upload(projectId, itemId, planId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success('ファイルを添付しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '添付に失敗しました'),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(projectId, itemId, planId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success('添付を削除しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '削除に失敗しました'),
  });

  const rows = query.data ?? [];
  const canRemove = (a: Attachment) => isAdmin || (!!myMemberId && a.uploader?.id === myMemberId);

  return (
    <div className="flex flex-col gap-2">
      {query.isLoading && <Skeleton className="h-12 w-full rounded-lg" />}

      {query.data && rows.length === 0 && (
        <p className="text-text-tertiary text-label">添付ファイルはありません。</p>
      )}

      {rows.length > 0 && (
        <ul className="border-border divide-border divide-y rounded-xl border">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <Paperclip className="text-text-tertiary size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{a.filename}</span>
                <span className="text-text-tertiary block truncate text-label">
                  {formatBytes(a.sizeBytes)}
                  {a.uploader ? ` ・ ${a.uploader.name}` : ''}
                </span>
              </span>
              {/* 署名付き URL が発行できなかったときはボタンを出さない
                  (押しても失敗するボタンは「壊れている」ように見える) */}
              {a.downloadUrl && (
                <Button variant="ghost" size="icon-sm" asChild aria-label={`${a.filename} をダウンロード`}>
                  <a href={a.downloadUrl} download={a.filename}>
                    <Download className="size-4" />
                  </a>
                </Button>
              )}
              {canRemove(a) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${a.filename} を削除`}
                  disabled={removeMut.isPending}
                  onClick={() => removeMut.mutate(a.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            data-testid="attachment-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // 同じファイルを選び直せるよう値をクリアしておく
              e.target.value = '';
              if (file) uploadMut.mutate(file);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={uploadMut.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {uploadMut.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            ファイルを添付
          </Button>
        </div>
      )}
    </div>
  );
}
