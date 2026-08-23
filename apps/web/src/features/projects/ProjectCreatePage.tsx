import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DateField } from '@/components/ui/date-field';
import { PageHeader } from '@/components/layout/PageHeader';
import { Label } from '@/components/ui/label';
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
import { JOB_TITLES, JOB_TITLE_LABEL, MEMBER_TYPES, MEMBER_TYPE_LABEL, type JobTitle, type MemberType } from '@trakon/shared';

import { projectsApi, projectsQueryKey } from './api';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で入力してください');

const schema = z
  .object({
    name: z.string().trim().min(1, 'プロジェクト名は必須です').max(255),
    clientName: z.string().trim().max(255),
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
        memberType: z.enum(MEMBER_TYPES),
        jobTitle: z.string(),
      }),
    ),
    /** 進行責任者に据える参加者。members のインデックス (文字列は Select の値) */
    progressManagerIndex: z.string(),
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
    // 完全な空行は無視するが、一部だけ入力された行は氏名欄にエラーを出す (Figma node 78:18)
    v.members.forEach((m, idx) => {
      const filled = [m.email, m.organizationName, m.jobTitle].some((x) => x.trim() !== '');
      if (filled && m.name.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['members', idx, 'name'],
          message: '氏名を入力してください',
        });
      }
    });
    if (v.members.filter((m) => m.name.trim() !== '').length > 0 && v.progressManagerIndex === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['progressManagerIndex'],
        message: '進行責任者を選んでください',
      });
    }
  });
type FormValues = z.infer<typeof schema>;

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyMember = () => ({
  name: '',
  email: '',
  organizationName: '',
  memberType: 'production' as const,
  jobTitle: '',
});

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
      clientName: '',
      items: [{ name: '' }],
      members: [emptyMember()],
      progressManagerIndex: '',
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
    // 参加者はスケジュール担当者。氏名があれば登録し、メールは任意 (空欄は未登録)
    // 完全な空行は作成時に無視する (Figma node 78:18)
    const kept = values.members
      .map((m, index) => ({ m, index }))
      .filter(({ m }) => m.name.trim() !== '');
    const cleanedMembers = kept.map(({ m }) => ({
      name: m.name.trim(),
      email: m.email.trim() || undefined,
      organizationName: m.organizationName.trim(),
      memberType: m.memberType,
      jobTitle: (m.jobTitle as JobTitle) || undefined,
    }));
    // 進行責任者は「空行を除いたあとの位置」で送る
    const pmAt = kept.findIndex(({ index }) => String(index) === values.progressManagerIndex);
    createMut.mutate({
      name: values.name,
      clientName: values.clientName.trim() || undefined,
      startDate: values.startDate,
      endDate: values.endDate,
      items: cleanedItems,
      members: cleanedMembers,
      progressManagerIndex: pmAt >= 0 ? pmAt : undefined,
    });
  };

  const watchedMembers = form.watch('members');
  const watchedItems = form.watch('items');
  const namedMembers = watchedMembers
    .map((m, index) => ({ ...m, index }))
    .filter((m) => m.name.trim() !== '');
  const itemCount = watchedItems.filter((i) => i.name.trim() !== '').length;

  /** 末尾に空行を 1 行足して、その先頭欄へフォーカスする (Figma node 78:18)。 */
  const appendAndFocus = (kind: 'item' | 'member') => {
    if (kind === 'item') {
      items.append({ name: '' });
      requestAnimationFrame(() => form.setFocus(`items.${items.fields.length}.name`));
    } else {
      members.append(emptyMember());
      requestAnimationFrame(() => form.setFocus(`members.${members.fields.length}.name`));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        width="full"
        breadcrumb={<span>PROJECT SETUP</span>}
        title="新規プロジェクト"
        description="基本情報、制作物、参加者を設定します"
      />

      <form
        id="project-create-form"
        onSubmit={form.handleSubmit(onSubmit)}
        className="min-h-0 flex-1 overflow-auto px-8 py-10"
      >
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-10">
          <FormCard title="基本情報" description="プロジェクトの名称と期間を設定します">
            <Field label="プロジェクト名" error={form.formState.errors.name?.message}>
              <Input {...form.register('name')} placeholder="例：ブランドサイト制作" />
            </Field>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_180px_180px]">
              <Field label="クライアント名">
                <Input {...form.register('clientName')} placeholder="例：株式会社灯和食品" />
              </Field>
              <Field label="開始日" error={form.formState.errors.startDate?.message}>
                <DateField {...form.register('startDate')} />
              </Field>
              <Field label="終了日" error={form.formState.errors.endDate?.message}>
                <DateField {...form.register('endDate')} />
              </Field>
            </div>
          </FormCard>

          <FormCard title="制作物" description="入力順が、そのままスケジュールの列順になります">
            <span className="text-text-tertiary pl-16 text-tiny font-medium">制作物名</span>
            {items.fields.map((f, idx) => (
              <div key={f.id} className="flex items-center gap-4">
                <span className="text-text-tertiary w-12 shrink-0 text-right text-tiny font-medium tabular-nums">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <Input
                  className="h-[38px] flex-1"
                  placeholder="制作物名を入力"
                  {...form.register(`items.${idx}.name` as const)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={items.fields.length === 1}
                  onClick={() => items.remove(idx)}
                  aria-label={`制作物 ${idx + 1} を削除`}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            {form.formState.errors.items && (
              <p className="text-destructive text-xs">
                {form.formState.errors.items.message ?? '制作物を 1 件以上入力してください'}
              </p>
            )}
            <div>
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => appendAndFocus('item')}
                disabled={items.fields.length >= 50}
              >
                <Plus />
                制作物を追加
              </Button>
            </div>
          </FormCard>

          <FormCard title="参加者" description="参加者を登録し、プロジェクトの進行責任者を設定します">
            <div className="text-text-tertiary grid grid-cols-[1fr_1fr_1.3fr_1.5fr_1.2fr_36px] gap-3 text-tiny font-medium">
              <span className="flex items-center gap-1.5">
                氏名
                <Badge variant="brand" size="sm">
                  必須
                </Badge>
              </span>
              <span>所属</span>
              <span>通知先メール</span>
              <span>職種</span>
              <span>区分</span>
              <span />
            </div>
            {members.fields.map((f, idx) => (
              <div
                key={f.id}
                className="grid grid-cols-[1fr_1fr_1.3fr_1.5fr_1.2fr_36px] items-start gap-3"
              >
                <div className="flex flex-col gap-1">
                  <Input
                    className="h-[38px]"
                    placeholder="氏名"
                    {...form.register(`members.${idx}.name` as const)}
                  />
                  {form.formState.errors.members?.[idx]?.name && (
                    <span className="text-destructive text-micro">
                      {form.formState.errors.members[idx]?.name?.message}
                    </span>
                  )}
                </div>
                <Input
                  className="h-[38px]"
                  placeholder="所属"
                  {...form.register(`members.${idx}.organizationName` as const)}
                />
                <Input
                  className="h-[38px]"
                  type="email"
                  placeholder="通知先メール"
                  {...form.register(`members.${idx}.email` as const)}
                />
                <Select
                  value={form.watch(`members.${idx}.jobTitle`)}
                  onValueChange={(v) => form.setValue(`members.${idx}.jobTitle`, v)}
                >
                  <SelectTrigger size="sm" aria-label={`参加者 ${idx + 1} の職種`}>
                    <SelectValue placeholder="職種を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_TITLES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {JOB_TITLE_LABEL[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={form.watch(`members.${idx}.memberType`)}
                  onValueChange={(v) =>
                    form.setValue(`members.${idx}.memberType`, v as MemberType)
                  }
                >
                  <SelectTrigger size="sm" aria-label={`参加者 ${idx + 1} の区分`}>
                    <SelectValue placeholder="区分を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMBER_TYPES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {MEMBER_TYPE_LABEL[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={members.fields.length === 1}
                  onClick={() => members.remove(idx)}
                  aria-label={`参加者 ${idx + 1} を削除`}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-6">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => appendAndFocus('member')}
                disabled={members.fields.length >= 50}
              >
                <Plus />
                参加者を追加
              </Button>
              <p className="text-text-tertiary flex-1 text-mini">
                通知先メールには、確認TOSSやコメントRETURNなど、対応が必要なときに通知します。プロジェクト作成時には送信されません。
              </p>
            </div>

            <Separator className="my-2" />

            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-body font-medium">
                進行責任者
                <Badge variant="brand" size="sm">
                  必須
                </Badge>
              </span>
              <span className="text-text-tertiary text-mini">
                新しいタスクカードの進行責任者へ初期入力されます
              </span>
              <Select
                value={form.watch('progressManagerIndex')}
                onValueChange={(v) => form.setValue('progressManagerIndex', v)}
                disabled={namedMembers.length === 0}
              >
                <SelectTrigger aria-label="進行責任者">
                  <SelectValue
                    placeholder={
                      namedMembers.length === 0 ? 'まず参加者を入力してください' : '進行責任者を選択'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {namedMembers.map((m) => (
                    <SelectItem key={m.index} value={String(m.index)}>
                      {m.name}
                      {m.organizationName ? ` / ${m.organizationName}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.progressManagerIndex && (
                <span className="text-destructive text-xs">
                  {form.formState.errors.progressManagerIndex.message}
                </span>
              )}
              <p className="bg-brand-subtle text-text-secondary mt-2 rounded-xl p-4 text-mini">
                <span className="text-foreground block text-body font-medium">
                  進行責任者はタスクごとに変更できます
                </span>
                ここで選んだ人は初期値です。既存タスクの担当者を自動で書き換えることはありません。
              </p>
            </div>
          </FormCard>
        </div>
      </form>

      {/* 作成内容のサマリと主操作を画面下に固定する (Figma node 73:114) */}
      <div className="border-border flex shrink-0 flex-wrap items-center gap-6 border-t bg-background px-14 py-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-text-tertiary text-mini font-medium">作成される内容</span>
          <span className="text-body font-medium">
            制作物 {itemCount}件 ・ 参加者 {namedMembers.length}名 ・ 
            {form.watch('startDate')} – {form.watch('endDate')}
          </span>
        </div>
        <p className="text-text-tertiary flex-1 text-mini">すべての内容は作成後に変更できます</p>
        <Button type="button" variant="outline" size="lg" onClick={() => setCancelOpen(true)}>
          キャンセル
        </Button>
        <Button type="submit" form="project-create-form" size="lg" disabled={createMut.isPending}>
          {createMut.isPending && <Loader2 className="animate-spin" />}
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
            <AlertDialogAction onClick={() => navigate('/projects')}>取りやめる</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** フォームの 1 セクション (Figma node 76:2)。 */
function FormCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-input flex flex-col gap-4 rounded-xl border bg-background p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-text-tertiary text-tiny">{description}</p>
      </div>
      {children}
    </section>
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
