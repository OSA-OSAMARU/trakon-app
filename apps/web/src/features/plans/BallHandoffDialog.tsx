import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * ボールを受け渡すときのダイアログ (#206)。
 *
 * Figma「Schedule / Confirmation TOSS Modal」(node `45:26`) と
 * 「Schedule / Comment RETURN Modal」(node `45:8`)。
 *
 * 3 つの受け渡し (確認TOSS / コメントRETURN / 次工程への TOSS) で同じ形を使う。
 * **どれも「相手に何をしてほしいかを添えて渡す」という同じ動作**で、違うのは
 * 誰に渡るか・メッセージが必須かだけなので、見た目と入力欄を分けない。
 *
 * 入力した文言は進行履歴 (`ball_events.note`) に残り、相手への通知メールにも載る。
 */
export type BallHandoffKind = 'review-request' | 'comment-return' | 'toss';

const COPY: Record<
  BallHandoffKind,
  {
    title: string;
    description: string;
    fieldLabel: string;
    placeholder: string;
    helper: string;
    submitLabel: string;
    /** メッセージが必須か。コメントRETURN だけ必須 */
    required: boolean;
  }
> = {
  'review-request': {
    title: '確認TOSS',
    description: 'ボールを承認者へ渡します。確認してほしい内容を添えられます。',
    fieldLabel: '確認してほしい内容（任意）',
    placeholder: '例：ファーストビューのコピーと写真のバランスをご確認ください。',
    helper: 'メッセージは承認者へ通知され、進行履歴に保存されます。',
    submitLabel: '確認TOSSする',
    required: false,
  },
  'comment-return': {
    title: 'コメントRETURN',
    description: 'ボールを実施者へ戻します。戻す理由を入力してください。',
    fieldLabel: '戻す内容',
    placeholder: '例：商品写真をもう少し大きくして、コピーとの優先順位を調整してください。',
    helper: 'コメントは実施者へ通知され、進行履歴に保存されます。',
    submitLabel: 'RETURNする',
    // 理由が無いと実施者は何を直せばよいか分からない
    required: true,
  },
  toss: {
    title: '次の工程へトス',
    description: 'ボールを後続予定の実施者へ渡します。申し送りを添えられます。',
    fieldLabel: '申し送り（任意）',
    placeholder: '例：ロゴデータは共有フォルダの final/ に入れています。',
    helper: 'メッセージは後続の実施者へ通知され、進行履歴に保存されます。',
    submitLabel: 'TOSSする',
    required: false,
  },
};

export function BallHandoffDialog({
  kind,
  open,
  onClose,
  onSubmit,
  pending,
  planTitle,
  contextLabel,
  handoffLabel,
}: {
  kind: BallHandoffKind;
  open: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
  pending: boolean;
  /** 対象の予定名 */
  planTitle: string;
  /** 「プロジェクト名｜制作物名」 */
  contextLabel: string;
  /** 「渡す人 → 受け取る人」。相手が未設定なら null */
  handoffLabel: string | null;
}) {
  const copy = COPY[kind];
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  // 開き直すたびに前回の入力を持ち越さない
  useEffect(() => {
    if (open) {
      setNote('');
      setTouched(false);
    }
  }, [open]);

  const missing = copy.required && note.trim() === '';

  const submit = () => {
    setTouched(true);
    if (missing) return;
    onSubmit(note.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {/* 何のボールを動かそうとしているかを、押す直前にもう一度見せる (Figma node 45:26) */}
        <div className="bg-accent rounded-lg px-4 py-3">
          <p className="text-body font-medium">{planTitle}</p>
          <p className="text-text-secondary mt-0.5 flex flex-wrap gap-x-4 text-label">
            <span>{contextLabel}</span>
            {handoffLabel && <span>{handoffLabel}</span>}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ball-handoff-note">{copy.fieldLabel}</Label>
          <Textarea
            id="ball-handoff-note"
            rows={4}
            autoFocus
            value={note}
            placeholder={copy.placeholder}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
          />
          {touched && missing && (
            <p className="text-destructive text-label">戻す内容を入力してください</p>
          )}
          <p className="text-text-tertiary text-label">{copy.helper}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {copy.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
