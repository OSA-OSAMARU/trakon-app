import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  BILLING_PLANS,
  JOB_TITLES,
  JOB_TITLE_LABEL,
  PROJECT_ROLES,
  PROJECT_ROLE_DESCRIPTION,
  PROJECT_ROLE_LABEL,
  type JobTitle,
  type ProjectRole,
} from '@trakon/shared';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { ApiClientError } from '@/lib/api';
import { useEntitlement } from '@/features/billing/useEntitlement';
import { projectsApi, projectsQueryKey } from '@/features/projects/api';
import { membersApi } from '@/features/projects/membersApi';
import { orgApi, orgQueryKey, type OrgMember } from './api';

/**
 * 組織のメンバー管理 (#160) — Figma node 406:22
 *
 * この画面が扱うのは **「座席の台帳」**、契約の枠を消費しているアカウントの一覧。
 * フリープランの「予定上に表示されるだけの参加者」はアカウントを持たないので出てこない
 * (そちらはプロジェクトの参加者管理 SC-11 が扱う)。
 */
export function OrgMembersPage() {
  const qc = useQueryClient();
  const { entitlement, canManageBilling, isLoading: billingLoading } = useEntitlement();
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleChange, setRoleChange] = useState<{ member: OrgMember; to: ProjectRole } | null>(null);
  const [removing, setRemoving] = useState<OrgMember | null>(null);
  const [projectsOf, setProjectsOf] = useState<OrgMember | null>(null);

  const membersQuery = useQuery({
    queryKey: orgQueryKey.members,
    queryFn: () => orgApi.listMembers(),
    // 管理権限が無いと 403 になるので、そもそも投げない
    enabled: canManageBilling,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: orgQueryKey.members });
    // 座席の残数が変わる
    qc.invalidateQueries({ queryKey: ['billing'] });
  };

  const roleMut = useMutation({
    mutationFn: (v: { userId: string; roleType: ProjectRole }) =>
      orgApi.changeRole(v.userId, v.roleType),
    onSuccess: () => {
      invalidate();
      toast.success('権限を変更しました');
      setRoleChange(null);
    },
    onError: (e) => toast.error(msg(e, '権限を変更できませんでした')),
  });

  const removeMut = useMutation({
    mutationFn: (m: OrgMember) =>
      m.userId ? orgApi.removeMember(m.userId) : orgApi.revokeInvitation(m.invitationId!),
    onSuccess: (_d, m) => {
      invalidate();
      toast.success(m.status === 'invited' ? '招待を取り消しました' : 'メンバーを削除しました');
      setRemoving(null);
    },
    onError: (e) => toast.error(msg(e, '削除できませんでした')),
  });

  const membersData = membersQuery.data;
  const filtered = useMemo(() => {
    const rows = membersData ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [membersData, search]);

  if (billingLoading) return <PageSkeleton />;

  if (!canManageBilling) {
    return (
      <>
        <PageHeader title="メンバー管理" description="契約メンバーの招待・権限・利用状況を管理します" />
        <PageContainer>
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-muted-foreground text-sm">
                メンバー管理は組織のオーナーまたは管理者のみが利用できます。
              </p>
            </CardContent>
          </Card>
        </PageContainer>
      </>
    );
  }

  const planLabel = entitlement ? BILLING_PLANS[entitlement.effectivePlanCode].label : '';
  const seatLimit = entitlement?.limits.seatLimit ?? null;
  const seatCount = entitlement?.usage.seatCount ?? 0;
  const canInvite = !!entitlement && (entitlement.canInviteMember || entitlement.canInviteViewer);

  return (
    <>
      <PageHeader
        title="メンバー管理"
        description="契約メンバーの招待・権限・利用状況を管理します"
      />
      <PageContainer>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div>
              <p className="text-base font-semibold">{planLabel} プラン</p>
              <p className="text-text-secondary mt-0.5 text-mini">
                {seatCount} / {seatLimit ?? '無制限'}名 利用中
              </p>
              <p className="text-text-tertiary text-mini">
                プロジェクト数：
                {entitlement?.limits.projectLimit === null
                  ? '無制限'
                  : `${entitlement?.usage.projectCount ?? 0} / ${entitlement?.limits.projectLimit}`}
              </p>
            </div>
            <Button onClick={() => setInviteOpen(true)} disabled={!canInvite}>
              <Plus className="size-4" />
              メンバーを招待
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">メンバー一覧</CardTitle>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="氏名・メールで検索"
                aria-label="氏名・メールで検索"
                className="w-full max-w-64"
              />
            </div>
          </CardHeader>
          <CardContent>
            {membersQuery.isLoading && <Skeleton className="h-40 w-full rounded-md" />}
            {membersQuery.error && (
              <p className="text-destructive text-sm">メンバーを取得できませんでした</p>
            )}
            {membersQuery.data && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>氏名</TableHead>
                    <TableHead>所属</TableHead>
                    <TableHead>通知先メール</TableHead>
                    <TableHead>職種</TableHead>
                    <TableHead>権限</TableHead>
                    <TableHead>参加PJ</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m) => (
                    <TableRow key={m.userId ?? m.invitationId}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <Avatar name={m.name} src={m.avatarUrl} className="size-7 text-mini" />
                          <span className="truncate font-medium">{m.name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {m.organizationName || '—'}
                      </TableCell>
                      <TableCell className="text-text-secondary">{m.email}</TableCell>
                      <TableCell className="text-text-secondary">
                        {m.jobTitle ? JOB_TITLE_LABEL[m.jobTitle] : '—'}
                      </TableCell>
                      <TableCell>
                        {m.status === 'invited' ? (
                          <Badge variant="brand">招待中</Badge>
                        ) : (
                          <Select
                            value={m.defaultProjectRole}
                            onValueChange={(v) =>
                              setRoleChange({ member: m, to: v as ProjectRole })
                            }
                            // オーナーは常に管理者 (自分の組織から締め出されないため)
                            disabled={m.orgRole === 'owner' || roleMut.isPending}
                          >
                            <SelectTrigger
                              className="h-8 w-32"
                              aria-label={`${m.name} の権限`}
                            >
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
                        )}
                      </TableCell>
                      <TableCell>
                        {m.userId && m.projectCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => setProjectsOf(m)}
                            className="text-brand inline-flex items-center gap-0.5 hover:underline"
                          >
                            {m.projectCount}件
                            <ChevronRight className="size-3.5" />
                          </button>
                        ) : (
                          <span className="text-text-secondary">{m.projectCount}件</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`${m.name} の操作`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => setRemoving(m)}
                              disabled={m.orgRole === 'owner'}
                              className="text-destructive"
                            >
                              {m.status === 'invited' ? '招待を取り消す' : 'メンバーを削除'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                        {search ? '該当するメンバーがいません。' : 'メンバーがいません。'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageContainer>

      {inviteOpen && (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          onDone={() => {
            invalidate();
            setInviteOpen(false);
          }}
        />
      )}

      <AlertDialog open={!!roleChange} onOpenChange={(o) => !o && setRoleChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>権限を変更しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {roleChange &&
                `${roleChange.member.name} さんの権限を、${PROJECT_ROLE_LABEL[roleChange.member.defaultProjectRole]}から${PROJECT_ROLE_LABEL[roleChange.to]}へ変更します。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {roleChange && (
            <div className="space-y-2">
              <div className="bg-accent flex items-center justify-center gap-4 rounded-md px-4 py-2.5 text-sm">
                <span>{PROJECT_ROLE_LABEL[roleChange.member.defaultProjectRole]}</span>
                <span aria-hidden>→</span>
                <span className="text-brand font-semibold">
                  {PROJECT_ROLE_LABEL[roleChange.to]}
                </span>
              </div>
              <p className="text-text-secondary text-xs">
                {PROJECT_ROLE_DESCRIPTION[roleChange.to]}
              </p>
              {/* 既定値の変更ではなく実際の権限変更であることを明示する */}
              {roleChange.member.projectCount > 0 && (
                <p className="text-text-tertiary text-xs">
                  参加中の {roleChange.member.projectCount} 件のプロジェクトすべてに反映されます。
                </p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (roleChange?.member.userId) {
                  roleMut.mutate({ userId: roleChange.member.userId, roleType: roleChange.to });
                }
              }}
              disabled={roleMut.isPending}
            >
              {roleMut.isPending && <Loader2 className="size-4 animate-spin" />}
              権限を変更
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing?.status === 'invited'
                ? `${removing?.name} さんへの招待を取り消しますか？`
                : `${removing?.name} さんを削除しますか？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.status === 'invited'
                ? '招待リンクは無効になり、利用枠が 1 名分戻ります。'
                : 'この組織の利用枠から外れ、編集ができなくなります。プロジェクト上の表示と履歴は残ります。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (removing) removeMut.mutate(removing);
              }}
              disabled={removeMut.isPending}
            >
              {removeMut.isPending && <Loader2 className="size-4 animate-spin" />}
              {removing?.status === 'invited' ? '招待を取り消す' : '削除する'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MemberProjectsSheet member={projectsOf} onClose={() => setProjectsOf(null)} />
    </>
  );
}

function msg(e: unknown, fallback: string): string {
  return e instanceof ApiClientError ? e.message : fallback;
}

// -----------------------------------------------------------------------------
// 招待モーダル (Figma node 409:22)
// -----------------------------------------------------------------------------

const NO_JOB_TITLE = '__none__';

const inviteSchema = z.object({
  name: z.string().trim().min(1, '氏名は必須').max(100),
  email: z.string().trim().min(1, '通知先メールは必須').email('メールアドレスの形式が正しくありません'),
  organizationName: z.string().trim().max(255),
  jobTitle: z.string(),
  roleType: z.enum(PROJECT_ROLES),
});
type InviteValues = z.infer<typeof inviteSchema>;

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { entitlement } = useEntitlement();
  const [projectIds, setProjectIds] = useState<string[]>([]);

  const projectsQuery = useQuery({
    queryKey: projectsQueryKey.all,
    queryFn: () => projectsApi.list(),
  });

  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      name: '',
      email: '',
      organizationName: '',
      jobTitle: NO_JOB_TITLE,
      roleType: 'editor',
    },
  });

  const mut = useMutation({
    mutationFn: (v: InviteValues) =>
      orgApi.invite({
        name: v.name,
        email: v.email,
        organizationName: v.organizationName || undefined,
        jobTitle: v.jobTitle === NO_JOB_TITLE ? null : (v.jobTitle as JobTitle),
        roleType: v.roleType,
        ...(projectIds.length > 0 ? { projectIds } : {}),
      }),
    onSuccess: () => {
      toast.success('招待を送信しました');
      onDone();
    },
    onError: (e) => toast.error(msg(e, '招待を送信できませんでした')),
  });

  const roleType = form.watch('roleType');
  const isViewer = roleType === 'viewer';
  const limit = isViewer ? entitlement?.limits.viewerLimit : entitlement?.limits.seatLimit;
  const used = isViewer ? entitlement?.usage.viewerCount : entitlement?.usage.seatCount;
  const remaining = limit === null || limit === undefined ? null : Math.max(0, limit - (used ?? 0));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>メンバーを招待</DialogTitle>
          <DialogDescription>TRAKONに招待するメンバーの情報と権限を設定します。</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={form.handleSubmit((v) => mut.mutate(v))}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="氏名"
              htmlFor="invite-name"
              required
              error={form.formState.errors.name?.message}
            >
              <Input
                id="invite-name"
                {...form.register('name')}
                placeholder="例：田中 太郎"
                autoFocus
              />
            </Field>
            <Field
              label="所属"
              htmlFor="invite-organization"
              error={form.formState.errors.organizationName?.message}
            >
              <Input
                id="invite-organization"
                {...form.register('organizationName')}
                placeholder="会社名・組織名"
              />
            </Field>
          </div>

          <Field
            label="通知先メール"
            htmlFor="invite-email"
            required
            error={form.formState.errors.email?.message}
          >
            <Input
              id="invite-email"
              type="email"
              {...form.register('email')}
              placeholder="name@example.com"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="職種">
              <Select
                value={form.watch('jobTitle')}
                onValueChange={(v) => form.setValue('jobTitle', v)}
              >
                <SelectTrigger aria-label="職種">
                  <SelectValue placeholder="職種を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_JOB_TITLE}>未設定</SelectItem>
                  {JOB_TITLES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {JOB_TITLE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="権限" required>
              <Select
                value={roleType}
                onValueChange={(v) => form.setValue('roleType', v as ProjectRole)}
              >
                <SelectTrigger aria-label="権限">
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
            </Field>
          </div>

          {/* 招待時にプロジェクトを選べるようにしている (Figma には無い)。
              選ばないと受諾した人に何も見えない状態で入ってきてしまうため。 */}
          <Field label="参加プロジェクト（任意）">
            <div className="border-border max-h-40 space-y-1.5 overflow-y-auto rounded-md border p-3">
              {(projectsQuery.data ?? []).length === 0 && (
                <p className="text-text-tertiary text-xs">プロジェクトがありません。</p>
              )}
              {(projectsQuery.data ?? []).map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={projectIds.includes(p.id)}
                    onChange={(e) =>
                      setProjectIds((prev) =>
                        e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id),
                      )
                    }
                    className="border-input accent-primary size-4 shrink-0 rounded"
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </Field>

          <div className="bg-brand-subtle rounded-md px-4 py-3">
            <p className="text-body font-medium">
              {isViewer ? '招待すると閲覧者枠を1名分使用します' : '招待すると利用枠を1名分使用します'}
            </p>
            <p className="text-text-secondary mt-0.5 text-mini">
              {remaining === null
                ? '現在の空きは無制限です。'
                : `現在の空きは${remaining}名です。`}
              招待中のメンバーも枠に含まれます。
              {isViewer && ' 閲覧者は管理者・編集者の枠を消費しません。'}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mut.isPending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending && <Loader2 className="size-4 animate-spin" />}
              招待を送信
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// 参加プロジェクトのドロワー (Figma node 414:358)
// -----------------------------------------------------------------------------

function MemberProjectsSheet({
  member,
  onClose,
}: {
  member: OrgMember | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const userId = member?.userId ?? null;

  const query = useQuery({
    queryKey: orgQueryKey.memberProjects(userId ?? ''),
    queryFn: () => orgApi.listMemberProjects(userId!),
    enabled: !!userId,
  });

  const removeMut = useMutation({
    mutationFn: (v: { projectId: string; memberId: string }) =>
      membersApi.remove(v.projectId, v.memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgQueryKey.memberProjects(userId ?? '') });
      qc.invalidateQueries({ queryKey: orgQueryKey.members });
      toast.success('プロジェクトから外しました');
    },
    onError: (e) => toast.error(msg(e, 'プロジェクトから外せませんでした')),
  });

  return (
    <Sheet open={!!member} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>参加プロジェクト</SheetTitle>
          <SheetDescription>
            このメンバーが参加しているプロジェクトと、対応待ちのボール数を確認できます。
          </SheetDescription>
        </SheetHeader>
        {member && (
          <div className="space-y-4 px-4 pb-6">
            <div>
              <p className="text-base font-semibold">{member.name}</p>
              <p className="text-text-secondary text-mini">{member.email}</p>
              <p className="text-brand mt-1 text-mini">
                {PROJECT_ROLE_LABEL[member.defaultProjectRole]} ・{' '}
                {member.projectCount}件のプロジェクトに参加
              </p>
            </div>

            {query.isLoading && <Skeleton className="h-24 w-full rounded-md" />}
            <ul className="divide-border divide-y">
              {(query.data ?? []).map((p) => (
                <li key={p.projectId} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      to={`/projects/${p.projectId}`}
                      className="text-body font-medium hover:underline"
                    >
                      {p.projectName}
                    </Link>
                    <p className="text-text-secondary text-mini">
                      Ball Holder：{p.ballHolderCount}件
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                    onClick={() =>
                      removeMut.mutate({ projectId: p.projectId, memberId: p.memberId })
                    }
                    disabled={removeMut.isPending}
                  >
                    プロジェクトから外す
                  </Button>
                </li>
              ))}
            </ul>
            {query.data?.length === 0 && (
              <p className="text-muted-foreground text-sm">参加しているプロジェクトはありません。</p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  htmlFor,
  required,
  error,
  children,
}: {
  label: string;
  /** 入力要素の id。ラベルと結びつけて読み上げ・クリックで到達できるようにする */
  htmlFor?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className={required ? 'text-brand' : undefined}>
        {label}
        {required && <span aria-hidden> ＊</span>}
      </Label>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-8 py-10">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
