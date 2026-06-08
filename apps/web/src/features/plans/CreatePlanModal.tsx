import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { DateField } from '@/components/ui/date-field';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiClientError } from '@/lib/api';
import type { ProjectMember } from '@/features/projects/membersApi';
import {
  PLAN_CATEGORIES,
  plansApi,
  plansQueryKey,
  type Plan,
  type PlanCategory,
} from './api';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式');

const schema = z
  .object({
    title: z.string().trim().min(1, '予定名は必須').max(255),
    category: z.enum(PLAN_CATEGORIES.map((c) => c.value) as [PlanCategory, ...PlanCategory[]]),
    scheduledDate: isoDate,
    dueDate: z.union([isoDate, z.literal('')]).optional(),
    fromMemberId: z.string().uuid('FROM を選択してください'),
    toMemberId: z.string().uuid('TO を選択してください'),
    successorPlanId: z.string().optional(),
    memo: z.string().max(2000).optional(),
  })
  .refine((v) => v.fromMemberId !== v.toMemberId, {
    path: ['toMemberId'],
    message: 'FROM と TO は異なるメンバーを選んでください',
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.scheduledDate, {
    path: ['dueDate'],
    message: '期日は開始日以降にしてください',
  });
type FormValues = z.infer<typeof schema>;

export function CreatePlanModal({
  projectId,
  itemId,
  members,
  plans,
  mode,
  defaultDate,
  defaultDueDate,
  defaultFromMemberId,
  planId,
  onClose,
}: {
  projectId: string;
  itemId: string;
  members: ProjectMember[];
  plans: Plan[];
  mode: 'create' | 'edit';
  defaultDate?: string;
  defaultDueDate?: string;
  defaultFromMemberId?: string;
  planId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editingPlan = mode === 'edit' && planId ? plans.find((p) => p.id === planId) : undefined;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      category: 'other',
      scheduledDate: defaultDate ?? new Date().toISOString().slice(0, 10),
      dueDate: defaultDueDate ?? '',
      fromMemberId: defaultFromMemberId ?? '',
      toMemberId: '',
      successorPlanId: '',
      memo: '',
    },
  });

  useEffect(() => {
    if (editingPlan) {
      form.reset({
        title: editingPlan.title,
        category: editingPlan.category,
        scheduledDate: editingPlan.scheduledDate,
        dueDate: editingPlan.dueDate ?? '',
        fromMemberId: editingPlan.fromMember?.id ?? '',
        toMemberId: editingPlan.toMember?.id ?? '',
        successorPlanId: editingPlan.successorPlanId ?? '',
        memo: editingPlan.memo ?? '',
      });
    }
  }, [editingPlan, form]);

  const createMut = useMutation({
    mutationFn: (v: FormValues) =>
      plansApi.create(projectId, itemId, {
        title: v.title,
        category: v.category,
        scheduledDate: v.scheduledDate,
        dueDate: v.dueDate || undefined,
        fromMemberId: v.fromMemberId,
        toMemberId: v.toMemberId,
        successorPlanId: v.successorPlanId || undefined,
        memo: v.memo || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(projectId) });
      toast.success('予定を作成しました');
      onClose();
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '作成に失敗しました'),
  });

  const updateMut = useMutation({
    mutationFn: (v: FormValues) => {
      if (!editingPlan) throw new Error('No plan to update');
      return plansApi.update(projectId, itemId, editingPlan.id, {
        title: v.title,
        category: v.category,
        scheduledDate: v.scheduledDate,
        dueDate: v.dueDate || null,
        successorPlanId: v.successorPlanId || null,
        memo: v.memo ?? null,
        // FROM/TO は TOSS 前のみ送信 (ロック中はサーバ側でも拒否される)
        ...(fromToEditable
          ? { fromMemberId: v.fromMemberId, toMemberId: v.toMemberId }
          : {}),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, itemId) });
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(projectId) });
      toast.success('予定を更新しました');
      onClose();
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '更新に失敗しました'),
  });

  const submitting = createMut.isPending || updateMut.isPending;
  const onSubmit = (v: FormValues) => (mode === 'edit' ? updateMut.mutate(v) : createMut.mutate(v));

  // 後続候補は同じ制作物 (item) 内の active な予定のみ
  const successorCandidates = plans.filter(
    (p) => p.itemId === itemId && p.id !== editingPlan?.id && p.status === 'active',
  );

  // FROM/TO は新規作成時、または TOSS 前 (ボール未移動) の予定編集時のみ変更可。
  const fromToEditable = mode === 'create' || editingPlan?.ballState === 'ready';

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{mode === 'edit' ? '予定を編集' : '予定を追加'}</SheetTitle>
          <SheetDescription>
            {mode === 'edit'
              ? 'FROM/TO・後続の予定を含む基本情報を変更します（FROM/TO は TOSS 前のみ変更可）。カレンダー上でカードをドラッグして期間を変更することもできます。'
              : 'カレンダー上に予定（ボール）を作成します'}
          </SheetDescription>
        </SheetHeader>

        <form
          id="plan-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex-1 space-y-3 overflow-y-auto pr-1"
        >
          <Field label="予定名" error={form.formState.errors.title?.message}>
            <Input {...form.register('title')} autoFocus placeholder="例: トップページ構成" />
          </Field>

          <Field label="カテゴリ" error={form.formState.errors.category?.message}>
            <SelectField
              value={form.watch('category')}
              onChange={(v) => form.setValue('category', v as PlanCategory)}
              options={PLAN_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="FROM (現在のホルダー)"
              error={form.formState.errors.fromMemberId?.message}
            >
              <SelectField
                value={form.watch('fromMemberId') || undefined}
                onChange={(v) => form.setValue('fromMemberId', v)}
                disabled={!fromToEditable}
                options={members.map((m) => ({ value: m.id, label: `${m.name} (${m.organizationName || '—'})` }))}
                placeholder="選択"
              />
            </Field>
            <Field label="TO (次の担当)" error={form.formState.errors.toMemberId?.message}>
              <SelectField
                value={form.watch('toMemberId') || undefined}
                onChange={(v) => form.setValue('toMemberId', v)}
                disabled={!fromToEditable}
                options={members.map((m) => ({ value: m.id, label: `${m.name} (${m.organizationName || '—'})` }))}
                placeholder="選択"
              />
            </Field>
          </div>
          {mode === 'edit' && !fromToEditable && (
            <p className="text-[11px] text-muted-foreground">
              TOSS 後のため FROM/TO は変更できません。
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="開始日" error={form.formState.errors.scheduledDate?.message}>
              <DateField {...form.register('scheduledDate')} />
            </Field>
            <Field label="終了日 (任意)" error={form.formState.errors.dueDate?.message}>
              <DateField {...form.register('dueDate')} />
            </Field>
          </div>

          <Field
            label="後続の予定 (任意)"
            hint="この予定が完了したら自動的に次の予定が TOSS されます"
          >
            <SelectField
              value={form.watch('successorPlanId') || undefined}
              onChange={(v) => form.setValue('successorPlanId', v === '__none__' ? '' : v)}
              options={[
                { value: '__none__', label: '紐付けない' },
                ...successorCandidates.map((p) => ({ value: p.id, label: p.title })),
              ]}
              placeholder="紐付けない"
            />
          </Field>

          <Field label="メモ (任意)">
            <Textarea {...form.register('memo')} rows={3} />
          </Field>
        </form>

        <SheetFooter className="sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button form="plan-form" type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {mode === 'edit' ? '保存' : '追加'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value?: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
