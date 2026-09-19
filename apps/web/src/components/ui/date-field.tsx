import * as React from 'react';
import { CalendarDays } from 'lucide-react';

import { Calendar } from './calendar';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from './utils';

/**
 * 日付入力フィールド。
 *
 * ネイティブ `<input type="date">` の上に、Figma「06 Form Controls」の
 * カレンダー (node `342:102`) をポップオーバーで重ねている (#196)。
 *
 * **ネイティブのピッカーをやめた理由**: OS とブラウザごとに見た目も操作も違い、
 * TRAKON の他の画面と揃わない。日付はこのアプリで最も頻繁に触る入力なので、
 * ここだけ別物の UI が出るのは体験として一番目立つズレになる。
 *
 * 入力欄自体は `type="date"` のまま残しているので、キーボードでの直接入力・
 * フォームのバリデーション・RHF の `register` はこれまでどおり動く。
 */
export const DateField = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, onChange, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const [open, setOpen] = React.useState(false);
    // 表示中の値。RHF の register は value を渡さない (非制御) ので DOM から読む。
    const [shown, setShown] = React.useState<string>(String(props.defaultValue ?? props.value ?? ''));

    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
    };

    /**
     * カレンダーで選んだ日付を input へ書き戻す。
     *
     * React は value を自前のセッターで管理しているため、`el.value = ...` だけでは
     * onChange が発火しない。ネイティブのセッターを呼んでから input イベントを
     * 投げることで、RHF を含む購読側に通常の入力と同じ形で伝わる。
     */
    const commit = (date: string) => {
      const el = innerRef.current;
      setShown(date);
      setOpen(false);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(el, date);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    return (
      <div className="relative">
        <Input
          ref={setRefs}
          type="date"
          className={cn('pr-10 [&::-webkit-calendar-picker-indicator]:hidden', className)}
          onChange={(e) => {
            setShown(e.target.value);
            onChange?.(e);
          }}
          {...props}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="カレンダーを開く"
              disabled={props.disabled}
              className="text-text-tertiary hover:text-foreground absolute inset-y-0 right-0 flex items-center pr-4 disabled:pointer-events-none"
            >
              <CalendarDays className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-3">
            <Calendar
              value={shown || null}
              onSelect={commit}
              min={typeof props.min === 'string' ? props.min : undefined}
              max={typeof props.max === 'string' ? props.max : undefined}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  },
);
DateField.displayName = 'DateField';
