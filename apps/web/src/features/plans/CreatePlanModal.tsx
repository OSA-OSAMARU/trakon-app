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
import type { ProjectItem } from '@/features/projects/api';
import {
  PLAN_CATEGORIES,
  plansApi,
  plansQueryKey,
  type Plan,
  type PlanCategory,
} from './api';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式');

const memberField = z.union([z.string().uuid(), z.literal('')]).optional();

const schema = z
  .object({
    title: z.string().trim().min(1, '予定名は必須').max(255),
    category: z.enum(PLAN_CATEGORIES.map((c) => c.value) as [PlanCategory, ...PlanCategory[]]),
    scheduledDate: isoDate,
    dueDate: z.union([isoDate, z.literal('')]).optional(),
    // 役割 (#131)。1 人が複数役割を兼ねることも可 (相違制約なし §5)。
    executorMemberId: memberField,
    approverMemberId: memberField,
    progressManagerMemberId: memberField,
    // 別制作物への移動 (#52)。編集時のみ変更可。
    itemId: z.string().uuid().optional(),
    successorPlanId: z.string().optional(),
    memo: z.string().max(2000).optional(),
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
  items,
  mode,
  defaultDate,
  defaultDueDate,
  defaultFromMemberId,
  defaultProgressManagerMemberId,
  planId,
  onClose,
}: {
  projectId: string;
  itemId: string;
  members: ProjectMember[];
  plans: Plan[];
  items: ProjectItem[];
  mode: 'create' | 'edit';
  defaultDate?: string;
  defaultDueDate?: string;
  /** 実施者の初期値 (現在選択中の担当者、#131 §9)。 */
  defaultFromMemberId?: string;
  /** 進行責任者の初期値 (プロジェクト既定、#131 §9)。 */
  defaultProgressManagerMemberId?: string;
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
      executorMemberId: defaultFromMemberId ?? '',
      approverMemberId: '',
      progressManagerMemberId: defaultProgressManagerMemberId ?? '',
      itemId,
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
        executorMemberId: editingPlan.executor?.id ?? '',
        approverMemberId: editingPlan.approver?.id ?? '',
        progressManagerMemberId: editingPlan.progressManager?.id ?? '',
        itemId: editingPlan.itemId,
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
        executorMemberId: v.executorMemberId || undefined,
        approverMemberId: v.approverMemberId || undefined,
        progressManagerMemberId: v.progressManagerMemberId || undefined,
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
      // 別制作物へ移動する場合は successor 指定を送らない (BE 側で自動解除される #52)
      const moving = !!v.itemId && v.itemId !== editingPlan.itemId;
      return plansApi.update(projectId, editingPlan.itemId, editingPlan.id, {
        title: v.title,
        category: v.category,
        scheduledDate: v.scheduledDate,
        dueDate: v.dueDate || null,
        memo: v.memo ?? null,
        ...(moving ? { itemId: v.itemId } : { successorPlanId: v.successorPlanId || null }),
        // 実施者/承認者は実施中のみ、進行責任者は TOSS 前のみ変更可 (ロック中はサーバも拒否)。
        // 空選択は null を送って未設定に戻す (#114)。
        ...(rolesEditable
          ? { executorMemberId: v.executorMemberId || null, approverMemberId: v.approverMemberId || null }
          : {}),
        ...(pmEditable ? { progressManagerMemberId: v.progressManagerMemberId || null } : {}),
      });
    },
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, editingPlan!.itemId) });
      // 移動先の item 一覧も無効化 (#52)
      if (v.itemId && v.itemId !== editingPlan!.itemId) {
        qc.invalidateQueries({ queryKey: plansQueryKey.list(projectId, v.itemId) });
      }
      qc.invalidateQueries({ queryKey: plansQueryKey.projectList(projectId) });
      toast.success(
        v.itemId && v.itemId !== editingPlan!.itemId ? '別の制作物へ移動しました' : '予定を更新しました',
      );
      onClose();
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '更新に失敗しました'),
  });

  const submitting = createMut.isPending || updateMut.isPending;
  const onSubmit = (v: FormValues) => (mode === 'edit' ? updateMut.mutate(v) : createMut.mutate(v));

  // 移動先 (#52) を含めた現在の対象 item。後続候補もこの item に追従する。
  const selectedItemId = form.watch('itemId') || itemId;

  // 後続候補は同じ制作物 (item) 内の active な予定のみ
  const successorCandidates = plans.filter(
    (p) => p.itemId === selectedItemId && p.id !== editingPlan?.id && p.status === 'active',
  );

  // 実施者/承認者は新規作成時、または実施中/差し戻し中のみ変更可 (確認依頼・承認後はロック)。
  const rolesEditable =
    mode === 'create' ||
    editingPlan?.ballState === 'in_progress' ||
    editingPlan?.ballState === 'sent_back';
  // 進行責任者は TOSS 前ならいつでも変更可 (§9)。
  const pmEditable =
    mode === 'create' || (editingPlan?.status === 'active' && editingPlan?.ballState !== 'tossed');

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{mode === 'edit' ? '予定を編集' : '予定を追加'}</SheetTitle>
          <SheetDescription>
            {mode === 'edit'
              ? '役割・後続の予定を含む基本情報を変更します。カレンダー上でカードをドラッグして期間を変更することもできます。'
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

          {/* 制作物の付け替え (#52)。別制作物へ移すと後続の予定は自動解除される。 */}
          {mode === 'edit' && items.length > 1 && (
            <Field
              label="制作物"
              hint={
                selectedItemId !== editingPlan?.itemId
                  ? '別の制作物へ移動します。後続の予定の紐付けは自動的に解除されます。'
                  : undefined
              }
            >
              <SelectField
                value={selectedItemId}
                onChange={(v) => {
                  form.setValue('itemId', v);
                  // 移動先が変わると後続候補が変わるため紐付けをリセット
                  if (v !== editingPlan?.itemId) form.setValue('successorPlanId', '');
                }}
                options={items.map((i) => ({ value: i.id, label: i.name }))}
              />
            </Field>
          )}

          {(() => {
            const memberOptions = [
              { value: '__none__', label: '未設定' },
              ...members.map((m) => ({
                value: m.id,
                label: `${m.name} (${m.organizationName || '—'})`,
              })),
            ];
            return (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="実施者" error={form.formState.errors.executorMemberId?.message}>
                    <SelectField
                      value={form.watch('executorMemberId') || '__none__'}
                      onChange={(v) => form.setValue('executorMemberId', v === '__none__' ? '' : v)}
                      disabled={!rolesEditable}
                      options={memberOptions}
                      placeholder="選択"
                    />
                  </Field>
                  <Field
                    label="承認者 (任意)"
                    hint="未設定なら実施者自身が承認できます"
                    error={form.formState.errors.approverMemberId?.message}
                  >
                    <SelectField
                      value={form.watch('approverMemberId') || '__none__'}
                      onChange={(v) => form.setValue('approverMemberId', v === '__none__' ? '' : v)}
                      disabled={!rolesEditable}
                      options={memberOptions}
                      placeholder="選択"
                    />
                  </Field>
                </div>
                <Field
                  label="進行責任者"
                  hint="承認済みの予定を後続へ TOSS できる人です"
                  error={form.formState.errors.progressManagerMemberId?.message}
                >
                  <SelectField
                    value={form.watch('progressManagerMemberId') || '__none__'}
                    onChange={(v) =>
                      form.setValue('progressManagerMemberId', v === '__none__' ? '' : v)
                    }
                    disabled={!pmEditable}
                    options={memberOptions}
                    placeholder="選択"
                  />
                </Field>
              </>
            );
          })()}
          {mode === 'edit' && !rolesEditable && (
            <p className="text-[11px] text-muted-foreground">
              確認依頼・承認後のため実施者/承認者は変更できません。
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
            hint="承認後、進行責任者がこの予定を次の予定へ TOSS できます"
          >
            <SelectField
              value={form.watch('successorPlanId') || undefined}
              onChange={(v) => form.setValue('successorPlanId', v === '__none__' ? '' : v)}
              disabled={selectedItemId !== (editingPlan?.itemId ?? itemId)}
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
