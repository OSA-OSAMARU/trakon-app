import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2, Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
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
import { projectsApi, projectsQueryKey } from './api';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で入力してください');

const schema = z
  .object({
    name: z.string().trim().min(1, 'プロジェクト名は必須です').max(255),
    startDate: isoDate,
    endDate: isoDate,
    items: z
      .array(z.object({ name: z.string().trim().max(255) }))
      .min(1, '制作物は最低 1 件必要です'),
    members: z.array(
      z.object({
        name: z.string().trim().max(100),
        email: z.string().trim().max(320),
        organizationName: z.string().trim().max(255),
        memberType: z.enum(['client', 'production']),
      }),
    ),
  })
  .refine((v) => v.endDate >= v.startDate, {
    path: ['endDate'],
    message: '終了日は開始日以降にしてください',
  })
  .superRefine((v, ctx) => {
    if (v.items.filter((i) => i.name.trim() !== '').length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: '制作物を 1 件以上入力してください',
      });
    }
  });
type FormValues = z.infer<typeof schema>;

const todayIso = () => new Date().toISOString().slice(0, 10);

export function ProjectCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      startDate: todayIso(),
      endDate: todayIso(),
      items: [{ name: '' }],
      members: [{ name: '', email: '', organizationName: '', memberType: 'production' }],
    },
  });

  const items = useFieldArray({ control: form.control, name: 'items' });
  const members = useFieldArray({ control: form.control, name: 'members' });

  const createMut = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: projectsQueryKey.all });
      toast.success('プロジェクトを作成しました');
      navigate(`/projects/${created.id}/edit`, { replace: true });
    },
    onError: (err) => {
      const msg =
        err instanceof ApiClientError ? err.message : '作成に失敗しました。時間をおいてお試しください。';
      toast.error(msg);
    },
  });

  const onSubmit = (values: FormValues) => {
    const cleanedItems = values.items.filter((i) => i.name.trim() !== '');
    const cleanedMembers = values.members.filter(
      (m) => m.name.trim() !== '' || m.email.trim() !== '',
    );
    createMut.mutate({
      name: values.name,
      startDate: values.startDate,
      endDate: values.endDate,
      items: cleanedItems,
      members: cleanedMembers,
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="mx-auto max-w-3xl space-y-6 px-8 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">プロジェクトを新規作成</h1>
          <p className="text-sm text-muted-foreground">基本情報・制作物・参加者をまとめて入力します</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
          <ArrowLeft className="size-4" />
          一覧に戻る
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="プロジェクト名" error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} placeholder="例: 自社サイトリニューアル" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="開始日" error={form.formState.errors.startDate?.message}>
              <Input type="date" {...form.register('startDate')} />
            </Field>
            <Field label="終了日" error={form.formState.errors.endDate?.message}>
              <Input type="date" {...form.register('endDate')} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">制作物</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.fields.map((f, idx) => (
            <div key={f.id} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`items.${idx}.name`}>制作物 {idx + 1}</Label>
                <Input
                  id={`items.${idx}.name`}
                  placeholder="例: トップページ"
                  {...form.register(`items.${idx}.name` as const)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={items.fields.length === 1}
                onClick={() => items.remove(idx)}
                aria-label="制作物を削除"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {form.formState.errors.items && (
            <p className="text-xs text-destructive">
              {form.formState.errors.items.message ?? '制作物を 1 件以上入力してください'}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => items.append({ name: '' })}
            disabled={items.fields.length >= 50}
          >
            <Plus className="size-4" />
            制作物を追加
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">参加者（任意）</CardTitle>
          <p className="text-xs text-muted-foreground">
            未入力の行はスキップされます。招待メール送信は次回リリースで有効化されます。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {members.fields.map((f, idx) => (
            <div key={f.id} className="space-y-2 rounded-md border border-border p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="氏名">
                  <Input {...form.register(`members.${idx}.name` as const)} />
                </Field>
                <Field label="所属">
                  <Input {...form.register(`members.${idx}.organizationName` as const)} />
                </Field>
              </div>
              <div className="grid grid-cols-[1fr_10rem_auto] gap-3">
                <Field label="メール">
                  <Input
                    type="email"
                    {...form.register(`members.${idx}.email` as const)}
                  />
                </Field>
                <Field label="種別">
                  <Select
                    defaultValue={f.memberType}
                    onValueChange={(v) =>
                      form.setValue(`members.${idx}.memberType`, v as 'client' | 'production')
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="種別" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="production">制作側</SelectItem>
                      <SelectItem value="client">クライアント</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="self-end"
                  onClick={() => members.remove(idx)}
                  aria-label="参加者を削除"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              members.append({ name: '', email: '', organizationName: '', memberType: 'production' })
            }
            disabled={members.fields.length >= 50}
          >
            <Plus className="size-4" />
            参加者を追加
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setCancelOpen(true)}>
          キャンセル
        </Button>
        <Button type="submit" disabled={createMut.isPending}>
          {createMut.isPending && <Loader2 className="size-4 animate-spin" />}
          プロジェクトを作成
        </Button>
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>作成を取りやめますか？</AlertDialogTitle>
            <AlertDialogDescription>入力中の内容は保存されません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>続ける</AlertDialogCancel>
            <AlertDialogAction onClick={() => navigate('/projects')}>
              取りやめる
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
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
