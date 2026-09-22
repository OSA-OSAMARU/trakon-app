import {
  JOB_TITLE_LABEL,
  MEMBER_TYPES,
  MEMBER_TYPE_LABEL,
  PROJECT_ROLES,
  PROJECT_ROLE_DESCRIPTION,
  PROJECT_ROLE_LABEL,
  type MemberType,
  type ProjectRole,
} from '@trakon/shared';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Plus, Trash2, UsersRound, ArrowLeft, KanbanSquare, GripVertical, X } from 'lucide-react';
import { MemberKanbanTab } from '@/features/plans/MemberKanbanTab';
import { toast } from 'sonner';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { ApiClientError } from '@/lib/api';
import { cn } from '@/components/ui/utils';
import { moveItem, useDragReorder } from '@/lib/reorder';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { MemberSelect, NoCandidatesHint } from '@/features/organization/OrgMemberSelect';
import type { MemberCandidate } from '@/features/organization/api';
import { membersApi, membersQueryKey, type ProjectMember } from './membersApi';
import { invitationsApi, invitationsQueryKey } from './invitationsApi';

export function MembersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'manage' ? 'manage' : 'kanban';
  const selectedItemId = params.get('itemId');

  const membersQuery = useQuery({
    queryKey: membersQueryKey.list(projectId ?? ''),
    queryFn: () => membersApi.list(projectId!),
    enabled: !!projectId,
  });

  if (!projectId) return <NotFound projectId={undefined} />;

  return (
    <>
      <PageHeader
        width="xl"
        title="参加者・かんばん"
        description="プロジェクトのメンバーとボールを管理します"
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/projects/${projectId}/edit`}>
              <ArrowLeft className="size-4" />
              プロジェクト設定に戻る
            </Link>
          </Button>
        }
      />
      <PageContainer width="xl">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const sp = new URLSearchParams(params);
          if (v === 'manage') sp.set('tab', 'manage');
          else sp.delete('tab');
          setParams(sp, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="kanban">
            <KanbanSquare className="size-4" />
            メンバー
          </TabsTrigger>
          <TabsTrigger value="manage">
            <UsersRound className="size-4" />
            管理
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'kanban' ? (
        <MemberKanbanTab
          projectId={projectId}
          members={membersQuery.data ?? []}
          selectedItemId={selectedItemId}
          onChangeItem={(itemId) => {
            const sp = new URLSearchParams(params);
            if (itemId === '__all__') sp.delete('itemId');
            else sp.set('itemId', itemId);
            setParams(sp, { replace: true });
          }}
        />
      ) : (
        <ManageTab projectId={projectId} />
      )}
      </PageContainer>
    </>
  );
}

// -----------------------------------------------------------------------------
// 管理タブ
// -----------------------------------------------------------------------------
function ManageTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<ProjectMember | null>(null);

  const query = useQuery({
    queryKey: membersQueryKey.list(projectId),
    queryFn: () => membersApi.list(projectId),
  });

  const removeMut = useMutation({
    mutationFn: (memberId: string) => membersApi.remove(projectId, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersQueryKey.list(projectId) });
      toast.success('参加者を削除しました');
      setRemoving(null);
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '削除に失敗しました'),
  });

  // 並び替え (#111)。楽観更新でリストを即時入れ替え、失敗時はロールバック。
  const members = query.data ?? [];
  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) => membersApi.reorder(projectId, orderedIds),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: membersQueryKey.list(projectId) });
      const prev = qc.getQueryData<ProjectMember[]>(membersQueryKey.list(projectId));
      if (prev) {
        const byId = new Map(prev.map((m) => [m.id, m]));
        const next = orderedIds
          .map((id) => byId.get(id))
          .filter((m): m is ProjectMember => !!m);
        qc.setQueryData(membersQueryKey.list(projectId), next);
      }
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(membersQueryKey.list(projectId), ctx.prev);
      toast.error(e instanceof ApiClientError ? e.message : '並び替えに失敗しました');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: membersQueryKey.list(projectId) }),
  });

  const drag = useDragReorder((from, to) => {
    reorderMut.mutate(moveItem(members, from, to).map((m) => m.id));
  });

  // ロール変更 (FR-ROLE-03)。最後の管理者の降格はサーバーが LAST_ADMIN 409 で拒否する。
  const roleMut = useMutation({
    mutationFn: ({ memberId, roleType }: { memberId: string; roleType: ProjectRole }) =>
      membersApi.update(projectId, memberId, { roleType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersQueryKey.list(projectId) });
      toast.success('権限を変更しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '権限の変更に失敗しました'),
  });

  // 未受諾の招待 (座席を消費している) を一覧に混ぜて表示する
  const invitationsQuery = useQuery({
    queryKey: invitationsQueryKey.list(projectId),
    queryFn: () => invitationsApi.list(projectId),
  });
  const pendingByMemberId = new Map(
    (invitationsQuery.data ?? []).map((inv) => [inv.memberId, inv]),
  );

  const revokeMut = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.revoke(projectId, invitationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invitationsQueryKey.list(projectId) });
      qc.invalidateQueries({ queryKey: membersQueryKey.list(projectId) });
      toast.success('招待を取り消しました');
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '招待の取り消しに失敗しました'),
  });

  // 管理者が 0 名になる操作は UI 側でも無効化する (サーバーでも 409 で弾く)
  const adminCount = members.filter((m) => m.roleType === 'admin').length;
  const isLastAdmin = (m: ProjectMember) => m.roleType === 'admin' && adminCount <= 1;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-heading-section">参加者一覧</CardTitle>
          <div className="flex items-center gap-2">
            {/* 組織にまだ居ない人はここでは招待できない (#202)。
                メンバー管理で組織へ招待してから、この画面で選ぶ一本道にしている。 */}
            <Button size="sm" variant="secondary" asChild>
              <Link to="/settings/members">
                <UsersRound className="size-4" />
                メンバー管理
              </Link>
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              参加者を追加
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading && <Skeleton className="h-32 w-full rounded-md" />}
        {query.error && (
          <p className="text-body text-destructive">参加者の取得に失敗しました</p>
        )}
        {query.data && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>氏名</TableHead>
                <TableHead>所属</TableHead>
                <TableHead>メール</TableHead>
                <TableHead>職種</TableHead>
                <TableHead>区分</TableHead>
                <TableHead>権限</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m, idx) => {
                return (
                  <TableRow
                    key={m.id}
                    {...drag.rowProps(idx)}
                    className={cn(
                      drag.fromIndex === idx && 'opacity-50',
                      drag.overIndex === idx && drag.fromIndex !== idx && 'border-t-2 border-t-primary',
                    )}
                  >
                    <TableCell className="pr-0">
                      <span
                        {...drag.handleProps(idx)}
                        className="inline-flex cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                        aria-label="ドラッグして並び替え"
                        title="ドラッグして並び替え"
                      >
                        <GripVertical className="size-4" />
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Avatar name={m.name} src={m.avatarUrl} className="size-6 text-label" />
                        <span className="truncate">{m.name}</span>
                        {/* アカウントを持つ人と、予定上に表示されるだけの人を見分けられるようにする (#160)。
                            前者だけが契約の枠を消費し、編集操作ができる。 */}
                        {m.userId ? (
                          <Badge variant="secondary" size="sm">
                            アカウント
                          </Badge>
                        ) : (
                          <Badge variant="outline" size="sm">
                            表示のみ
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.organizationName || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.email || '—'}</TableCell>
                    <TableCell className="text-label">
                      {m.jobTitle ? JOB_TITLE_LABEL[m.jobTitle] : '—'}
                    </TableCell>
                    <TableCell>
                      {MEMBER_TYPE_LABEL[m.memberType]}
                      {pendingByMemberId.has(m.id) && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-label text-muted-foreground">
                          招待中
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.userId ? (
                        <>
                          <Select
                            value={m.roleType}
                            onValueChange={(v) =>
                              roleMut.mutate({ memberId: m.id, roleType: v as ProjectRole })
                            }
                            disabled={roleMut.isPending || isLastAdmin(m)}
                          >
                            <SelectTrigger className="h-8 w-32" aria-label={`${m.name} の権限`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PROJECT_ROLES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {PROJECT_ROLE_LABEL[r]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {isLastAdmin(m) && (
                            <p className="mt-1 text-label text-muted-foreground">
                              管理者は 1 名以上必要です
                            </p>
                          )}
                        </>
                      ) : (
                        /* ログインできない相手に権限を持たせても意味がないので出さない (#160) */
                        <span className="text-muted-foreground text-label">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {pendingByMemberId.has(m.id) ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => revokeMut.mutate(pendingByMemberId.get(m.id)!.id)}
                          disabled={revokeMut.isPending}
                          aria-label="招待を取り消す"
                        >
                          <X className="size-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRemoving(m)}
                          disabled={isLastAdmin(m)}
                          aria-label="削除"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AddMembersDialog open={addOpen} onClose={() => setAddOpen(false)} projectId={projectId} />

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{removing?.name}」をプロジェクトから外しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              予定の担当になっている場合や操作履歴が残っている場合は削除できません。
              先に担当を別の参加者へ変更してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (removing) removeMut.mutate(removing.id);
              }}
              disabled={removeMut.isPending}
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// 参加者追加ダイアログ
// -----------------------------------------------------------------------------
/** 取得前の既定値。毎回新しい配列を作って useEffect を空回しさせないため */
const NO_CANDIDATES: MemberCandidate[] = [];

const addSchema = z.object({
  // 値はセレクトから来るので形式は問わない。UUID としての妥当性はサーバーが見る
  userId: z.string().min(1, 'メンバーを選択してください'),
  memberType: z.enum(MEMBER_TYPES),
  roleType: z.enum(PROJECT_ROLES),
});
type AddValues = z.infer<typeof addSchema>;

/**
 * 参加者追加ダイアログ (#202)。
 *
 * 氏名・メール・所属を手入力していた頃は、同じ人が案件ごとに別人として登録され、
 * 表記ゆれと「アカウントに紐づかない参加者」が量産されていた。組織メンバー
 * (メンバー管理の一覧) から選ぶ形に一本化し、アカウントを唯一の起点にする。
 *
 * ここで指定するのは**プロジェクトごとに変わるもの**だけ。氏名・メール・所属・職種は
 * アカウント側が正 (#156) なのでサーバーが引く。
 */
function AddMembersDialog({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const qc = useQueryClient();
  // 候補はサーバーが絞る (#238)。**このプロジェクトの組織**から引き、既にこの
  // プロジェクトに居る人を除いたものが返る。除いた人数も受け取り、候補が
  // 空のときは理由を出す。
  const candidatesQuery = useQuery({
    queryKey: membersQueryKey.candidates(projectId),
    queryFn: () => membersApi.candidates(projectId),
    enabled: open,
  });
  const selectable = candidatesQuery.data?.candidates ?? NO_CANDIDATES;

  const form = useForm<AddValues>({
    resolver: zodResolver(addSchema),
    defaultValues: { userId: '', memberType: 'production', roleType: 'editor' },
  });

  const selectedUserId = form.watch('userId');

  // 選んだ相手の既定ロールを初期値にする。組織で「この人は閲覧者」と決めてあるなら
  // プロジェクトでもそこから始めるのが自然 (その場で変更もできる)。
  useEffect(() => {
    const picked = selectable.find((m) => m.userId === selectedUserId);
    if (picked) form.setValue('roleType', picked.defaultProjectRole);
  }, [selectedUserId, selectable, form]);

  const addMut = useMutation({
    mutationFn: (v: AddValues) => membersApi.add(projectId, { members: [v] }),
    onSuccess: () => {
      // list は candidates を含む前方一致なので、候補も一緒に取り直される
      qc.invalidateQueries({ queryKey: membersQueryKey.list(projectId) });
      toast.success('参加者を追加しました');
      form.reset();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === 'ALREADY_MEMBER') {
        toast.error('この方は既にこのプロジェクトの参加者です');
      } else if (e instanceof ApiClientError && e.code === 'MEMBER_EMAIL_TAKEN') {
        toast.error('このメールアドレスは既に追加されています');
      } else {
        toast.error(e instanceof ApiClientError ? e.message : '追加に失敗しました');
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>参加者を追加</DialogTitle>
          <DialogDescription>
            メンバー管理に登録済みのメンバーから選んで、このプロジェクトに追加します。
          </DialogDescription>
        </DialogHeader>
        {!candidatesQuery.data && !candidatesQuery.error ? (
          <p className="text-text-tertiary text-body">読み込み中…</p>
        ) : candidatesQuery.error ? (
          <p className="text-body text-destructive">
            追加できるメンバーを取得できませんでした。時間をおいてお試しください。
          </p>
        ) : selectable.length === 0 ? (
          <NoCandidatesHint
            joinedCount={candidatesQuery.data?.joinedCount ?? 0}
            pendingCount={candidatesQuery.data?.pendingCount ?? 0}
            className="text-text-secondary text-body"
          />
        ) : (
          <form
            onSubmit={form.handleSubmit((v) => addMut.mutate(v))}
            className="space-y-3"
            id="add-member-form"
          >
            <Field label="メンバー" error={form.formState.errors.userId?.message}>
              <MemberSelect
                label="メンバー"
                options={selectable}
                value={selectedUserId}
                onChange={(v) => form.setValue('userId', v, { shouldValidate: true })}
              />
            </Field>
            <Field label="区分" error={form.formState.errors.memberType?.message}>
              <Select
                value={form.watch('memberType')}
                onValueChange={(v) => form.setValue('memberType', v as MemberType)}
              >
                <SelectTrigger aria-label="区分">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_TYPES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {MEMBER_TYPE_LABEL[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="権限" error={form.formState.errors.roleType?.message}>
              <Select
                value={form.watch('roleType')}
                onValueChange={(v) => form.setValue('roleType', v as ProjectRole)}
              >
                <SelectTrigger aria-label="権限">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_ROLES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {PROJECT_ROLE_LABEL[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-text-tertiary text-label">
                {PROJECT_ROLE_DESCRIPTION[form.watch('roleType')]}
              </p>
            </Field>
          </form>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            form="add-member-form"
            type="submit"
            disabled={addMut.isPending || selectable.length === 0}
          >
            {addMut.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            追加する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-label text-destructive">{error}</p>}
    </div>
  );
}

function NotFound({ projectId: _ }: { projectId: string | undefined }) {
  return (
    <div className="mx-auto max-w-3xl px-8 py-20 text-center text-body text-muted-foreground">
      プロジェクトが見つかりませんでした。
    </div>
  );
}
