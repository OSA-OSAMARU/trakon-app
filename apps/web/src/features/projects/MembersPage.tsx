import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Mail, Plus, Trash2, UsersRound, ArrowLeft, KanbanSquare } from 'lucide-react';
import { MemberKanbanTab } from '@/features/plans/MemberKanbanTab';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { membersApi, membersQueryKey, type ProjectMember } from './membersApi';

const STATUS_LABEL: Record<ProjectMember['inviteStatus'], { text: string; tone: 'default' | 'secondary' | 'destructive' }> = {
  accepted: { text: '参加中', tone: 'default' },
  pending: { text: '招待中', tone: 'secondary' },
  expired: { text: '期限切れ', tone: 'destructive' },
};

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
    <div className="mx-auto max-w-6xl space-y-5 px-8 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">参加者</h1>
          <p className="text-sm text-muted-foreground">
            プロジェクトのメンバーを管理します
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/projects/${projectId}/edit`}>
            <ArrowLeft className="size-4" />
            プロジェクト設定に戻る
          </Link>
        </Button>
      </header>

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
            sp.set('itemId', itemId);
            setParams(sp, { replace: true });
          }}
        />
      ) : (
        <ManageTab projectId={projectId} />
      )}
    </div>
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">参加者一覧</CardTitle>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            参加者を追加
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading && <Skeleton className="h-32 w-full rounded-md" />}
        {query.error && (
          <p className="text-sm text-destructive">参加者の取得に失敗しました</p>
        )}
        {query.data && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>氏名</TableHead>
                <TableHead>所属</TableHead>
                <TableHead>メール</TableHead>
                <TableHead>種別</TableHead>
                <TableHead>状態</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((m) => {
                const status = STATUS_LABEL[m.inviteStatus];
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.organizationName || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.email}</TableCell>
                    <TableCell className="text-xs">
                      {m.memberType === 'client' ? 'クライアント' : '制作側'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.tone}>{status.text}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setRemoving(m)}
                        aria-label="削除"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AddMembersDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectId={projectId}
      />

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{removing?.name}」をプロジェクトから外しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              担当ボールがある場合は再アサインを検討してください。
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
              削除する
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
const addSchema = z.object({
  name: z.string().trim().min(1, '氏名は必須').max(100),
  email: z.string().trim().email('メール形式が不正').max(320),
  organizationName: z.string().trim().max(255),
  memberType: z.enum(['client', 'production']),
});
type AddValues = z.infer<typeof addSchema>;

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
  const form = useForm<AddValues>({
    resolver: zodResolver(addSchema),
    defaultValues: { name: '', email: '', organizationName: '', memberType: 'production' },
  });

  const addMut = useMutation({
    mutationFn: (v: AddValues) => membersApi.add(projectId, { members: [v] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersQueryKey.list(projectId) });
      toast.success('招待メールを送信しました', {
        description: '（開発環境ではコンソールに出力されます）',
      });
      form.reset();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === 'MEMBER_EMAIL_TAKEN') {
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
            入力されたメールアドレスに招待を送ります（72 時間有効）。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((v) => addMut.mutate(v))}
          className="space-y-3"
          id="add-member-form"
        >
          <Field label="氏名" error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} autoFocus />
          </Field>
          <Field label="所属" error={form.formState.errors.organizationName?.message}>
            <Input {...form.register('organizationName')} />
          </Field>
          <Field label="メール" error={form.formState.errors.email?.message}>
            <Input type="email" {...form.register('email')} />
          </Field>
          <Field label="種別" error={form.formState.errors.memberType?.message}>
            <Select
              defaultValue="production"
              onValueChange={(v) =>
                form.setValue('memberType', v as 'client' | 'production')
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="production">制作側</SelectItem>
                <SelectItem value="client">クライアント</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button form="add-member-form" type="submit" disabled={addMut.isPending}>
            {addMut.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Mail className="size-4" />
            )}
            招待を送信
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
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function NotFound({ projectId: _ }: { projectId: string | undefined }) {
  return (
    <div className="mx-auto max-w-3xl px-8 py-20 text-center text-sm text-muted-foreground">
      プロジェクトが見つかりませんでした。
    </div>
  );
}
